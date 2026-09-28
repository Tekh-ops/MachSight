import asyncio
from collections import deque
import json
import logging
import os
from pathlib import Path
import sys
import time
from typing import Optional, List, Dict, Any
import uuid
import httpx

# Add sibling models/ folder to sys.path before any other imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "models"))

from ml.detector import score_reading
from ml.reference_builder import load_reference_set
from ml.features import process_reading, process_window
from ml.classify import classify
from ml.pipeline import analyze, build_evidence
from ml import reasoner

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, status
import db
import ml_stub

logger = logging.getLogger(__name__)

# Load baseline reference set at startup
ref_path = Path(__file__).resolve().parent.parent / "models" / "ml" / "reference.pkl"
if not ref_path.exists():
    ref_path = Path("../models/ml/reference.pkl")
REFERENCE = load_reference_set(str(ref_path))

# Thresholds and configuration
CONSECUTIVE_ANOMALY_THRESHOLD = int(os.environ.get("MACHSIGHT_CONSECUTIVE_ANOMALIES", "3"))
INVESTIGATION_COOLDOWN_SECONDS = float(os.environ.get("MACHSIGHT_INVESTIGATION_COOLDOWN", "15.0"))
MACHSIGHT_USE_STUB = os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")

app = FastAPI(title="industrialdoctor-backend")


async def warmup_ollama() -> None:
    """Performs a lightweight warmup query so the first investigation doesn't suffer a cold model load."""
    use_stub = (
        MACHSIGHT_USE_STUB
        or os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")
    )
    if use_stub:
        return
    model = os.environ.get("MACHSIGHT_LLM_MODEL", "qwen2.5:3b-instruct")
    ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": "warmup", "stream": False, "keep_alive": "30m"}
            )
        logger.info(f"Ollama warmup complete for model {model}")
    except Exception as e:
        logger.warning(f"Ollama warmup skipped ({type(e).__name__}): {e}")


@app.on_event("startup")
async def on_startup():
    asyncio.create_task(warmup_ollama())

# Active WebSocket connections for telemetry broadcasting
active_connections: list[WebSocket] = []

# Rolling buffer of recent raw telemetry readings
rolling_buffer: deque = deque(maxlen=300)
_reading_seq: int = 0
consecutive_anomalies: int = 0
is_investigating: bool = False
last_investigation_end_time: float = 0.0
investigation_lock = asyncio.Lock()


async def broadcast(event_type: str, data: dict):
    """Broadcasts an event message to all connected WebSocket clients."""
    message = {
        "type": event_type,
        "event": event_type,
        "data": data,
        **data,
    }
    for connection in list(active_connections):
        try:
            await connection.send_json(message)
        except Exception:
            if connection in active_connections:
                active_connections.remove(connection)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time telemetry streaming."""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)


@app.get("/health")
def health_check():
    return {"status": "ok"}


async def collect_window(seconds: float, timeout: Optional[float] = None) -> List[Dict[str, Any]]:
    """Keeps a rolling in-memory buffer of recent readings fed by the ingestion path.
    Waits for the requested seconds while new readings arrive, then returns the window.
    If the stream stops, returns what exists after a timeout.
    Async and non-blocking to ingestion.
    """
    global _reading_seq
    start_seq = _reading_seq
    wait_sec = max(0.1, float(seconds))
    max_timeout = timeout if timeout is not None else (wait_sec + 2.0)

    try:
        await asyncio.wait_for(asyncio.sleep(wait_sec), timeout=max_timeout)
    except asyncio.TimeoutError:
        pass

    # Collect readings that arrived after start_seq
    collected = [r for r in list(rolling_buffer) if r.get("_seq", 0) > start_seq]

    # If stream stopped or no new readings arrived, return recent buffer
    if not collected and rolling_buffer:
        collected = list(rolling_buffer)[-20:]

    return collected


async def trigger_investigation(reading: dict, processed: dict, result: dict):
    """Runs autonomous reasoning loop on anomalous telemetry readings."""
    global is_investigating, last_investigation_end_time

    # Single-flight guard
    if is_investigating:
        return

    # Check cooldown if called externally
    now = time.time()
    if (now - last_investigation_end_time) < INVESTIGATION_COOLDOWN_SECONDS:
        return

    async with investigation_lock:
        if is_investigating:
            return
        is_investigating = True
        try:
            trace_id = str(uuid.uuid4())
            history = []

            # Determine whether to use emergency stub or real LLM reasoner
            use_stub = (
                MACHSIGHT_USE_STUB
                or os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")
            )
            reason_fn = ml_stub.reason if use_stub else reasoner.reason

            # Initial evidence built using pipeline.build_evidence
            evidence = build_evidence(
                raw=reading,
                processed=processed,
                matches=result.get("matches", classify(processed, None)),
                window=None,
            )
            # Ensure backward-compatible top-level keys
            evidence.setdefault("reasons", result.get("reasons", []))
            evidence.setdefault("anomaly_score", result.get("anomaly_score", 0.0))
            for k in ("distance_cm", "current_a", "rpm", "pwm_command", "mode", "car_id"):
                if k in reading and k not in evidence:
                    evidence[k] = reading[k]

            # 1. Progressive diagnosis: immediately broadcast preliminary diagnosis (< 2ms)
            prelim_result = reasoner.reason_fallback(
                evidence=evidence,
                history=[],
                error_note="Preliminary rule match",
                stage="preliminary"
            )
            prelim_row = {
                "trace_id": trace_id,
                "timestamp": time.time(),
                "step_type": "diagnosis",
                "payload": json.dumps(prelim_result),
            }
            db.insert("investigations", prelim_row)
            await broadcast("diagnosis", prelim_row)

            # 2. Skip pointless loops: if top rule match score >= 0.85 and sustained, go straight to 1 LLM call
            top_matches = (
                evidence.get("top_rule_matches")
                or evidence.get("top_matches")
                or evidence.get("matches")
                or []
            )
            top_score = float(top_matches[0].get("score", 0.0)) if top_matches else 0.0
            second_score = float(top_matches[1].get("score", 0.0)) if len(top_matches) > 1 else 0.0
            is_decisive = (top_score >= 0.85 and (top_score - second_score >= 0.15))
            allow_more_data = not (is_decisive and consecutive_anomalies >= 3)
            max_loops = 1 if not allow_more_data else 3

            loop = asyncio.get_running_loop()

            for _ in range(max_loops):
                # Run reasoning in executor to prevent blocking the event loop
                reasoning_result = await loop.run_in_executor(None, reason_fn, evidence, history)

                action = reasoning_result.get("action")

                # If decisive, do not allow request_more_data; finalize diagnosis immediately
                if not allow_more_data and action == "request_more_data":
                    reasoning_result["action"] = "diagnose"
                    if not reasoning_result.get("diagnosis"):
                        reasoning_result["diagnosis"] = prelim_result.get("diagnosis")
                        reasoning_result["confidence"] = prelim_result.get("confidence")
                        reasoning_result["recommended_action"] = prelim_result.get("recommended_action")
                    action = "diagnose"

                if action == "diagnose":
                    reasoning_result["stage"] = "final"
                    diag_row = {
                        "trace_id": trace_id,
                        "timestamp": time.time(),
                        "step_type": "diagnosis",
                        "payload": json.dumps(reasoning_result),
                    }
                    db.insert("investigations", diag_row)
                    await broadcast("diagnosis", diag_row)
                    return

                if action == "request_more_data":
                    # Persist and broadcast intermediate reasoning step
                    step_row = {
                        "trace_id": trace_id,
                        "timestamp": time.time(),
                        "step_type": "reasoning",
                        "payload": json.dumps(reasoning_result),
                    }
                    db.insert("investigations", step_row)
                    await broadcast("investigation_step", step_row)

                    history.append(reasoning_result)
                    more_data = reasoning_result.get("more_data") or {}
                    requested_seconds = float(more_data.get("seconds", 2.0))

                    # Actually collect window of incoming telemetry
                    new_readings = await collect_window(seconds=requested_seconds)

                    # Reprocess with newly acquired window
                    window_stats = process_window(new_readings, REFERENCE)
                    latest_raw = new_readings[-1] if new_readings else reading
                    latest_processed = process_reading(latest_raw, REFERENCE, window=new_readings)
                    latest_matches = classify(latest_processed, window_stats)

                    evidence = build_evidence(
                        raw=latest_raw,
                        processed=latest_processed,
                        matches=latest_matches,
                        window=window_stats,
                    )
                    evidence.setdefault("reasons", latest_processed.get("reasons", []))
                    evidence.setdefault("anomaly_score", latest_processed.get("mahalanobis_distance", 0.0))
                    for k in ("distance_cm", "current_a", "rpm", "pwm_command", "mode", "car_id"):
                        if k in latest_raw and k not in evidence:
                            evidence[k] = latest_raw[k]
                    continue

            # Fallback when loops exhausted: never return inconclusive if rule match >= 0.50 exists
            if top_score >= 0.50:
                final_fallback = reasoner.reason_fallback(
                    evidence=evidence,
                    history=history,
                    error_note="Max investigation depth reached; resolved from rule classification",
                    stage="final"
                )
                final_fallback["stage"] = "final"
                fallback_row = {
                    "trace_id": trace_id,
                    "timestamp": time.time(),
                    "step_type": "diagnosis",
                    "payload": json.dumps(final_fallback),
                }
                db.insert("investigations", fallback_row)
                await broadcast("diagnosis", fallback_row)
                return

            concrete_reason = "max investigation depth reached with low rule confidence (<0.50)"
            inconclusive_payload = {
                "action": "diagnose",
                "reasoning": f"Investigation inconclusive: {concrete_reason}.",
                "diagnosis": "inconclusive",
                "confidence": 0.0,
                "evidence_used": evidence.get("reasons", []),
                "recommended_action": "Manual technician inspection recommended.",
                "more_data": None,
                "severity": "warning",
                "ui_hints": {
                    "highlight_metrics": ["current_a", "rpm", "distance_cm"],
                    "suggested_charts": ["telemetry_overview"],
                },
                "reason": concrete_reason,
                "stage": "final",
            }
            inconclusive_row = {
                "trace_id": trace_id,
                "timestamp": time.time(),
                "step_type": "diagnosis",
                "payload": json.dumps(inconclusive_payload),
                "diagnosis": "inconclusive",
                "reason": concrete_reason,
            }
            db.insert("investigations", {
                "trace_id": trace_id,
                "timestamp": inconclusive_row["timestamp"],
                "step_type": "diagnosis",
                "payload": json.dumps(inconclusive_payload),
            })
            await broadcast("diagnosis", inconclusive_row)

        finally:
            is_investigating = False
            last_investigation_end_time = time.time()


@app.websocket("/telemetry/ingest")
async def telemetry_ingest_ws(websocket: WebSocket):
    global _reading_seq, consecutive_anomalies
    await websocket.accept()
    try:
        while True:
            reading = await websocket.receive_json()

            _reading_seq += 1
            reading["_seq"] = _reading_seq
            if "timestamp" not in reading or reading["timestamp"] is None:
                reading["timestamp"] = time.time()

            # Store in rolling buffer for collect_window
            rolling_buffer.append(reading)

            # Insert raw reading into raw_telemetry
            raw_id = db.insert(
                "raw_telemetry",
                {
                    "timestamp": reading.get("timestamp"),
                    "car_id": reading.get("car_id"),
                    "distance_cm": reading.get("distance_cm"),
                    "current_a": reading.get("current_a"),
                    "rpm": reading.get("rpm"),
                    "pwm_command": reading.get("pwm_command"),
                    "mode": reading.get("mode"),
                },
            )

            # Call pipeline.analyze() using recent buffer as window
            analysis = analyze(
                raw=reading,
                recent_window=list(rolling_buffer)[-20:],
                reference=REFERENCE,
            )
            processed = analysis["processed"]
            matches = analysis["matches"]
            is_anomaly = analysis["is_anomaly"]

            # Insert into processed_telemetry
            processed_row = {
                "raw_id": raw_id,
                "timestamp": reading.get("timestamp"),
                "current_rpm_ratio": processed["current_rpm_ratio"],
                "current_zscore": processed["current_zscore"],
                "rpm_zscore": processed["rpm_zscore"],
                "mahalanobis_distance": processed["mahalanobis_distance"],
                "distance_plausible": 1 if processed.get("distance_plausible", True) else 0,
                "bucket_used": processed.get("bucket_used", ""),
                "is_anomaly": 1 if is_anomaly else 0,
            }
            processed_id = db.insert("processed_telemetry", processed_row)

            # Broadcast event type "processed" in existing envelope
            await broadcast("processed", {**processed_row, "id": processed_id})

            # Check consecutive anomalies and trigger conditions
            if is_anomaly:
                consecutive_anomalies += 1
            else:
                consecutive_anomalies = 0

            time_since_last = time.time() - last_investigation_end_time
            if (
                consecutive_anomalies >= CONSECUTIVE_ANOMALY_THRESHOLD
                and not is_investigating
                and (time_since_last >= INVESTIGATION_COOLDOWN_SECONDS)
            ):
                consecutive_anomalies = 0
                result = {
                    "is_anomaly": is_anomaly,
                    "anomaly_score": processed["mahalanobis_distance"],
                    "reasons": processed.get("reasons", []),
                    "features": {
                        "current_a": {"z_score": processed["current_zscore"]},
                        "rpm": {"z_score": processed["rpm_zscore"]},
                    },
                    "matches": matches,
                }
                # Trigger investigation asynchronously so ingestion is never blocked
                asyncio.create_task(trigger_investigation(reading, processed, result))

    except WebSocketDisconnect:
        pass


@app.get("/api/telemetry")
def get_telemetry_history(
    since: Optional[float] = Query(default=None, description="Epoch timestamp cutoff"),
    limit: int = Query(default=100, ge=1, le=1000, description="Max rows to return"),
    downsample: int = Query(default=1, ge=1, le=100, description="Downsample stride"),
):
    """Returns historical raw and processed telemetry joined from SQLite."""
    sql = """
        SELECT 
            r.id as raw_id, r.timestamp, r.car_id, r.distance_cm, r.current_a, r.rpm, r.pwm_command, r.mode,
            p.id as processed_id, p.current_rpm_ratio, p.current_zscore, p.rpm_zscore,
            p.mahalanobis_distance, p.distance_plausible, p.bucket_used, p.is_anomaly
        FROM raw_telemetry r
        LEFT JOIN processed_telemetry p ON p.raw_id = r.id
        WHERE (? IS NULL OR r.timestamp >= ?)
        ORDER BY r.id DESC
        LIMIT ?
    """
    rows = db.query(sql, (since, since, limit))
    rows.reverse()  # chronological order
    if downsample > 1:
        rows = rows[::downsample]
    return {"count": len(rows), "data": rows}


@app.get("/api/investigations")
def get_investigations(
    limit: int = Query(default=50, ge=1, le=200, description="Max traces to return")
):
    """Returns recent investigations grouped by trace ID."""
    sql = """
        SELECT 
            trace_id,
            MIN(timestamp) as started_at,
            MAX(timestamp) as completed_at,
            COUNT(*) as step_count,
            MAX(CASE WHEN step_type = 'diagnosis' THEN payload ELSE NULL END) as final_payload
        FROM investigations
        GROUP BY trace_id
        ORDER BY started_at DESC
        LIMIT ?
    """
    traces = db.query(sql, (limit,))
    results = []
    for t in traces:
        final_diag = None
        if t.get("final_payload"):
            try:
                final_diag = json.loads(t["final_payload"])
            except Exception:
                final_diag = t["final_payload"]
        results.append({
            "trace_id": t["trace_id"],
            "started_at": t["started_at"],
            "completed_at": t["completed_at"],
            "step_count": t["step_count"],
            "final_diagnosis": final_diag,
        })
    return {"count": len(results), "investigations": results}


@app.get("/api/investigations/{trace_id}")
def get_investigation_trace(trace_id: str):
    """Returns the full chronological step trace for a given investigation."""
    sql = """
        SELECT id, trace_id, timestamp, step_type, payload
        FROM investigations
        WHERE trace_id = ?
        ORDER BY id ASC
    """
    steps = db.query(sql, (trace_id,))
    if not steps:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Investigation trace '{trace_id}' not found",
        )
    for s in steps:
        try:
            s["parsed_payload"] = json.loads(s["payload"])
        except Exception:
            s["parsed_payload"] = None
    return {"trace_id": trace_id, "step_count": len(steps), "steps": steps}


@app.get("/api/status")
def get_status():
    """Returns service health, LLM connectivity, active model, and database counts."""
    from ml.reasoner import MACHSIGHT_LLM_MODEL, OLLAMA_URL

    use_stub = (
        MACHSIGHT_USE_STUB
        or os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")
    )

    llm_reachable = False
    if not use_stub:
        try:
            with httpx.Client(timeout=1.0) as client:
                resp = client.get(f"{OLLAMA_URL.rstrip('/')}/api/tags")
                llm_reachable = (resp.status_code == 200)
        except Exception:
            llm_reachable = False

    raw_cnt = db.query("SELECT COUNT(*) as c FROM raw_telemetry")[0]["c"]
    proc_cnt = db.query("SELECT COUNT(*) as c FROM processed_telemetry")[0]["c"]
    inv_cnt = db.query("SELECT COUNT(*) as c FROM investigations")[0]["c"]

    now = time.time()
    cooldown_remaining = max(0.0, INVESTIGATION_COOLDOWN_SECONDS - (now - last_investigation_end_time))

    return {
        "status": "ok",
        "llm_reachable": llm_reachable,
        "active_model": "ml_stub" if use_stub else MACHSIGHT_LLM_MODEL,
        "fallback_active": not llm_reachable or use_stub,
        "is_investigating": is_investigating,
        "cooldown_active": cooldown_remaining > 0,
        "cooldown_remaining_seconds": round(cooldown_remaining, 1),
        "consecutive_anomalies": consecutive_anomalies,
        "rolling_buffer_size": len(rolling_buffer),
        "db_row_counts": {
            "raw_telemetry": raw_cnt,
            "processed_telemetry": proc_cnt,
            "investigations": inv_cnt,
        },
    }
