"""IndustrialDoctor / MachSight backend — Phase 1 Foundation.

Architecture:
    Telemetry source
        ↓
    Pydantic validation (telemetry_schema.IncomingTelemetry)
        ↓
    Machine-scoped state (machine_state.MachineStateRegistry)
        ↓
    ML pipeline (ml.pipeline.analyze)
        ↓
    Anomaly detection → Rule-based fault classification
        ↓
    Structured diagnostic evidence (ml.pipeline.build_evidence)
        ↓
    Qwen 2.5 3B reasoning (ml.reasoner.reason)  ← runs in executor, non-blocking
        ↓
    Schema validation → deterministic fallback if LLM fails
        ↓
    Diagnosis broadcast + DB persistence
"""

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, status
from contextlib import asynccontextmanager
from pydantic import ValidationError

# Add backend/ and sibling models/ folder to sys.path so that bare imports
# (e.g. `import config`, `import db`) work whether the app is launched from
# inside backend/ OR from the project root via `uvicorn backend.main:app`.
_backend_dir = str(Path(__file__).resolve().parent)
_models_dir  = str(Path(__file__).resolve().parent.parent / "models")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)
if _models_dir not in sys.path:
    sys.path.insert(0, _models_dir)

from ml.detector import score_reading
from ml.reference_builder import load_reference_set
from ml.features import process_reading, process_window
from ml.classify import classify
from ml.pipeline import analyze, build_evidence
from ml import reasoner

# Phase 2 — Intelligent diagnostic reasoning
from ml.temporal_evidence import extract_diagnostic_evidence, MachineOperatingState, Persistence
from ml.hypothesis_scorer import score_hypotheses
from ml.diagnostic_lifecycle import (
    diagnostic_lifecycle_registry,
    DiagnosticTrigger,
    DiagnosticLifecycleState,
)
from ml.diagnostic_reasoner import reason_v2, reason_fallback_v2, build_recovery_result

import config
import db
import ml_stub
from machine_state import machine_registry, MachineState
from telemetry_schema import IncomingTelemetry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Load baseline reference set at startup
# ---------------------------------------------------------------------------
ref_path = Path(__file__).resolve().parent.parent / "models" / "ml" / "reference.pkl"
if not ref_path.exists():
    ref_path = Path("../models/ml/reference.pkl")
REFERENCE = load_reference_set(str(ref_path))


# ---------------------------------------------------------------------------
# Application startup / lifespan
# ---------------------------------------------------------------------------

async def warmup_ollama() -> None:
    """Lightweight warmup query so the first investigation avoids cold-model lag.

    Application startup does NOT fail if Ollama is unreachable — the deterministic
    fallback remains fully functional.
    """
    if config.USE_STUB:
        return
    model = config.OLLAMA_MODEL
    ollama_url = config.OLLAMA_URL
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": "warmup", "stream": False, "keep_alive": "30m"}
            )
        logger.info(f"Ollama warmup complete for model {model}")
    except Exception as e:
        logger.warning(f"Ollama warmup skipped ({type(e).__name__}): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(warmup_ollama())
    yield


app = FastAPI(title="industrialdoctor-backend", lifespan=lifespan)

# Active WebSocket connections for telemetry broadcasting
active_connections: List[WebSocket] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def broadcast(event_type: str, data: dict) -> None:
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


async def collect_window(
    machine: MachineState,
    seconds: float,
    timeout: Optional[float] = None
) -> List[Dict[str, Any]]:
    """Waits `seconds` then returns new readings for the given machine.

    Non-blocking to telemetry ingestion — runs as part of the investigation
    coroutine in a separate asyncio task.
    """
    start_seq = machine.reading_seq
    wait_sec = max(0.1, float(seconds))
    max_timeout = timeout if timeout is not None else (wait_sec + 2.0)

    try:
        await asyncio.wait_for(asyncio.sleep(wait_sec), timeout=max_timeout)
    except asyncio.TimeoutError:
        pass

    return machine.collect_window_since(start_seq)


# ---------------------------------------------------------------------------
# Investigation loop (Objective 5)
# ---------------------------------------------------------------------------

async def trigger_investigation(
    machine_or_reading: Any,
    reading_or_processed: Any = None,
    processed_or_result: Any = None,
    result_or_none: Any = None,
) -> None:
    """Runs the autonomous reasoning loop for an anomalous machine.

    Guarantees:
      - Single-flight per machine (no duplicate investigations).
      - Non-blocking: runs as asyncio.create_task(), never stalls ingestion.
      - Bounded: at most config.INVESTIGATION_MAX_HOPS loop iterations.
      - Deterministic fallback if Ollama is unavailable / returns bad output.
      - Machine-isolated: state and buffer are scoped to `machine`.
      - Dual signature support: accepts either (machine, reading, processed, result)
        or legacy (reading, processed, result).
    """
    if isinstance(machine_or_reading, MachineState):
        machine = machine_or_reading
        reading = reading_or_processed
        processed = processed_or_result
        result = result_or_none
    else:
        reading = machine_or_reading
        processed = reading_or_processed
        result = processed_or_result
        m_id = reading.get("machine_id") or reading.get("car_id", "car-01")
        machine = machine_registry.get(m_id)

    # --- Single-flight guard (double-check inside lock) ---
    if machine.is_investigating:
        return

    now = time.time()
    if machine.is_on_cooldown(now):
        return

    async with machine.investigation_lock:
        if machine.is_investigating:
            return
        machine.mark_investigation_started()

    try:
        trace_id = str(uuid.uuid4())
        machine_id = machine.machine_id
        history: List[Dict[str, Any]] = []

        # Choose real LLM or stub reasoner
        use_stub = (
            config.USE_STUB
            or os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")
        )
        reason_fn = ml_stub.reason if use_stub else reasoner.reason

        # --- Phase 2: Extract temporal evidence packet ---
        recent_window_for_evidence = list(machine.rolling_buffer)[-config.ANALYSIS_WINDOW_SIZE:]
        window_seconds = len(recent_window_for_evidence) * 0.5  # ~0.5s per sample
        diag_packet = extract_diagnostic_evidence(
            machine_id=machine_id,
            window=recent_window_for_evidence,
            processed_latest=processed,
            matches=result.get("matches", []),
            window_seconds=max(window_seconds, 2.0),
        )

        # --- Phase 2: Get lifecycle tracker ---
        lifecycle = diagnostic_lifecycle_registry.get(machine_id)

        # --- Build initial evidence (Phase 1 backward compat) ---
        evidence = build_evidence(
            raw=reading,
            processed=processed,
            matches=result.get("matches", classify(processed, None)),
            window=None,
        )
        # Backward-compat top-level aliases
        evidence.setdefault("reasons", result.get("reasons", []))
        evidence.setdefault("anomaly_score", result.get("anomaly_score", 0.0))
        for k in ("distance_cm", "current_a", "rpm", "pwm_command", "mode", "car_id"):
            if k in reading and k not in evidence:
                evidence[k] = reading[k]

        # --- Step 1: Preliminary diagnosis (< 2 ms, synchronous, no LLM) ---
        prelim_result = reasoner.reason_fallback(
            evidence=evidence,
            history=[],
            error_note="Preliminary rule match",
            stage="preliminary"
        )
        prelim_result["suspected_component"] = evidence.get("suspected_component")
        prelim_row = {
            "trace_id": trace_id,
            "machine_id": machine_id,
            "timestamp": time.time(),
            "step_type": "diagnosis",
            "payload": json.dumps(prelim_result),
        }
        db.insert("investigations", prelim_row)
        await broadcast("diagnosis", prelim_row)

        # --- Determine investigation depth ---
        top_matches = (
            evidence.get("fault_hypotheses")
            or evidence.get("top_rule_matches")
            or evidence.get("top_matches")
            or evidence.get("matches")
            or []
        )
        top_score = float(top_matches[0].get("score", 0.0)) if top_matches else 0.0
        initial_top_score = top_score
        second_score = float(top_matches[1].get("score", 0.0)) if len(top_matches) > 1 else 0.0
        is_decisive = top_score >= 0.85 and (top_score - second_score >= 0.15)

        # If already decisive and sustained anomalies, skip the multi-hop loop
        allow_more_data = not (is_decisive and machine.consecutive_anomalies >= 3)
        max_loops = 1 if not allow_more_data else config.INVESTIGATION_MAX_HOPS

        loop = asyncio.get_running_loop()

        # --- Step 2: Investigation loop (max_loops hops) ---
        for hop in range(max_loops):
            # Run reasoning (executor if sync function, direct await if async / coroutine)
            if asyncio.iscoroutinefunction(reason_fn):
                reasoning_result = await reason_fn(evidence, history)
            else:
                reasoning_result = await loop.run_in_executor(
                    None, reason_fn, evidence, history
                )
                if asyncio.iscoroutine(reasoning_result):
                    reasoning_result = await reasoning_result

            action = reasoning_result.get("action")

            # Decisive path: override request_more_data → diagnose immediately
            if not allow_more_data and action == "request_more_data":
                reasoning_result["action"] = "diagnose"
                if not reasoning_result.get("diagnosis"):
                    reasoning_result["diagnosis"] = prelim_result.get("diagnosis")
                    reasoning_result["confidence"] = prelim_result.get("confidence")
                    reasoning_result["recommended_action"] = prelim_result.get("recommended_action")
                action = "diagnose"

            if action == "diagnose":
                reasoning_result["stage"] = "final"
                # Inject suspected_component from evidence (deterministic, not from LLM)
                reasoning_result.setdefault(
                    "suspected_component",
                    evidence.get("suspected_component")
                )
                diag_row = {
                    "trace_id": trace_id,
                    "machine_id": machine_id,
                    "timestamp": time.time(),
                    "step_type": "diagnosis",
                    "payload": json.dumps(reasoning_result),
                }
                db.insert("investigations", diag_row)
                await broadcast("diagnosis", diag_row)

                # --- Phase 2: Run intelligent reasoning and emit diagnostic_update ---
                try:
                    if use_stub:
                        diag_v2 = reason_fallback_v2(diag_packet, fallback_reason="Stub mode")
                    else:
                        diag_v2 = await loop.run_in_executor(None, reason_v2, diag_packet)
                    diag_v2["trace_id"] = trace_id
                    lifecycle.mark_diagnosed()
                    await broadcast("diagnostic_update", {"diagnosis": diag_v2})
                    await broadcast("lifecycle", {
                        "machine_id": machine_id,
                        "state": "FAULT DETECTED",
                        "lifecycle_state": "DIAGNOSED",
                        "trigger": "diagnosis_complete",
                        "timestamp": time.time(),
                    })
                except Exception as _e2:
                    logger.warning(f"Phase 2 reasoning error (non-fatal): {_e2}")


                return

            if action == "request_more_data":
                # Persist and broadcast intermediate reasoning step
                step_row = {
                    "trace_id": trace_id,
                    "machine_id": machine_id,
                    "timestamp": time.time(),
                    "step_type": "reasoning",
                    "payload": json.dumps(reasoning_result),
                }
                db.insert("investigations", step_row)
                await broadcast("investigation_step", step_row)

                history.append(reasoning_result)
                more_data = reasoning_result.get("more_data") or {}
                requested_seconds = float(more_data.get("seconds", 2.0))

                # Collect new incoming readings (non-blocking)
                new_readings = await collect_window(machine, seconds=requested_seconds)

                # Re-process with the newly acquired window
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

        # --- Fallback when all hops are exhausted ---
        if initial_top_score >= 0.50:
            final_fallback = reasoner.reason_fallback(
                evidence=evidence,
                history=history,
                error_note="Max investigation depth reached; resolved from rule classification",
                stage="final"
            )
            final_fallback["stage"] = "final"
            final_fallback.setdefault("suspected_component", evidence.get("suspected_component"))
            fallback_row = {
                "trace_id": trace_id,
                "machine_id": machine_id,
                "timestamp": time.time(),
                "step_type": "diagnosis",
                "payload": json.dumps(final_fallback),
            }
            db.insert("investigations", fallback_row)
            await broadcast("diagnosis", fallback_row)
            return

        # Truly inconclusive
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
            "suspected_component": evidence.get("suspected_component"),
        }
        inconclusive_row = {
            "trace_id": trace_id,
            "machine_id": machine_id,
            "timestamp": time.time(),
            "step_type": "diagnosis",
            "payload": json.dumps(inconclusive_payload),
            "diagnosis": "inconclusive",
            "reason": concrete_reason,
        }
        db.insert("investigations", {
            "trace_id": trace_id,
            "machine_id": machine_id,
            "timestamp": inconclusive_row["timestamp"],
            "step_type": "diagnosis",
            "payload": json.dumps(inconclusive_payload),
        })
        await broadcast("diagnosis", inconclusive_row)

    finally:
        machine.mark_investigation_ended()


# ---------------------------------------------------------------------------
# WebSocket endpoints
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time telemetry broadcasting to dashboards."""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)


@app.websocket("/telemetry/ingest")
async def telemetry_ingest_ws(websocket: WebSocket) -> None:
    """WebSocket endpoint for telemetry ingestion.

    Validates each incoming packet via Pydantic before passing to the ML pipeline.
    Malformed packets are rejected with an error response; the connection stays open.

    Machine state (rolling buffer, anomaly counter, investigation) is isolated
    per machine_id so that multiple machines can be monitored simultaneously.
    """
    await websocket.accept()
    try:
        while True:
            raw_json = await websocket.receive_json()

            # --- Pydantic validation boundary ---
            try:
                telem = IncomingTelemetry.model_validate(raw_json)
            except ValidationError as ve:
                err_msg = {"error": "validation_failed", "detail": ve.errors()}
                try:
                    await websocket.send_json(err_msg)
                except Exception:
                    pass
                logger.warning(f"Telemetry validation failed: {ve}")
                continue

            # Convert to legacy flat dict for ML pipeline
            reading = telem.to_legacy_dict()
            machine_id = telem.machine_id

            # --- Machine-scoped state ---
            machine = machine_registry.get(machine_id)
            machine.append_reading(reading)

            # --- Persist raw telemetry ---
            raw_id = db.insert(
                "raw_telemetry",
                {
                    "timestamp": reading.get("timestamp"),
                    "car_id": reading.get("car_id"),
                    "machine_id": machine_id,
                    "asset_type": reading.get("asset_type", "rc_vehicle"),
                    "schema_version": reading.get("schema_version", config.TELEMETRY_SCHEMA_VERSION),
                    "distance_cm": reading.get("distance_cm"),
                    "current_a": reading.get("current_a"),
                    "rpm": reading.get("rpm"),
                    "pwm_command": reading.get("pwm_command"),
                    "mode": reading.get("mode"),
                    "voltage_v": reading.get("voltage_v"),
                    "temperature_c": reading.get("temperature_c"),
                    "vibration_rms": reading.get("vibration_rms"),
                    "pressure_bar": reading.get("pressure_bar"),
                },
            )

            # --- ML pipeline (analyze) using machine's rolling window ---
            recent_window = list(machine.rolling_buffer)[-config.ANALYSIS_WINDOW_SIZE:]
            analysis = analyze(
                raw=reading,
                recent_window=recent_window,
                reference=REFERENCE,
            )
            processed = analysis["processed"]
            matches = analysis["matches"]
            is_anomaly = analysis["is_anomaly"]

            # --- Persist processed telemetry ---
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

            # Broadcast processed event — include raw sensor values so the
            # frontend can render live telemetry sparklines (distance_cm, current_a,
            # rpm, mode, pwm_command) without a separate REST poll.
            raw_sensor_fields = {
                "machine_id": machine_id,
                "distance_cm": reading.get("distance_cm"),
                "current_a": reading.get("current_a"),
                "rpm": reading.get("rpm"),
                "mode": reading.get("mode", "idle"),
                "pwm_command": reading.get("pwm_command", 0),
            }
            await broadcast("processed", {**processed_row, "id": processed_id, **raw_sensor_fields})

            # --- Machine lifecycle & state transitions ---
            m_id = machine.machine_id
            lc = diagnostic_lifecycle_registry.get(m_id)

            # --- Update machine-scoped anomaly counter ---
            if is_anomaly:
                machine.record_anomaly()
            else:
                machine.reset_anomaly_counter()
                # Check for recovery if machine was faulted/diagnosed
                if lc.state in (DiagnosticLifecycleState.DIAGNOSED, DiagnosticLifecycleState.MONITORING):
                    recent_window = list(machine.rolling_buffer)[-config.ANALYSIS_WINDOW_SIZE:]
                    if len(recent_window) >= 2:
                        rec_packet = extract_diagnostic_evidence(
                            machine_id=m_id,
                            window=recent_window,
                            processed_latest=processed,
                            matches=[],
                            window_seconds=max(len(recent_window) * 0.5, 2.0),
                        )
                        prev_state = lc.state
                        trigger = lc.update(rec_packet, is_anomaly=False, consecutive_anomalies=0)
                        if lc.state != prev_state:
                            ui_state = (
                                "RECOVERING" if lc.state == DiagnosticLifecycleState.MONITORING
                                else ("RECOVERED" if lc.state == DiagnosticLifecycleState.RECOVERED else "HEALTHY")
                            )
                            await broadcast("lifecycle", {
                                "machine_id": m_id,
                                "state": ui_state,
                                "lifecycle_state": lc.state.value,
                                "trigger": trigger.value if trigger else "recovery_monitoring",
                                "timestamp": time.time(),
                            })
                            if lc.state == DiagnosticLifecycleState.RECOVERED:
                                recovery_diag = build_recovery_result(rec_packet)
                                recovery_diag["trace_id"] = str(uuid.uuid4())
                                await broadcast("diagnostic_update", {"diagnosis": recovery_diag})

            # --- Trigger investigation if threshold reached ---
            if machine.should_trigger_investigation():
                machine.reset_anomaly_counter()
                lc._transition(
                    DiagnosticLifecycleState.ANALYZING,
                    DiagnosticTrigger.ANOMALY_THRESHOLD,
                    operating_state="INVESTIGATING",
                    evidence_summary="Multivariate anomaly threshold reached. Investigating root cause.",
                )
                await broadcast("lifecycle", {
                    "machine_id": m_id,
                    "state": "INVESTIGATING",
                    "lifecycle_state": "ANALYZING",
                    "trigger": "anomaly_threshold",
                    "timestamp": time.time(),
                })
                result = {
                    "is_anomaly": is_anomaly,
                    "anomaly_score": processed["mahalanobis_distance"],
                    "reasons": processed.get("reasons", []),
                    "matches": matches,
                }
                # Fire investigation as a background task — NEVER blocks ingestion
                asyncio.create_task(
                    trigger_investigation(machine, reading, processed, result)
                )

    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/telemetry")
def get_telemetry_history(
    since: Optional[float] = Query(default=None, description="Epoch timestamp cutoff"),
    limit: int = Query(default=100, ge=1, le=1000, description="Max rows to return"),
    downsample: int = Query(default=1, ge=1, le=100, description="Downsample stride"),
    machine_id: Optional[str] = Query(default=None, description="Filter by machine_id"),
):
    """Returns historical raw and processed telemetry joined from SQLite."""
    if machine_id:
        sql = """
            SELECT
                r.id as raw_id, r.timestamp, r.car_id, r.machine_id, r.asset_type,
                r.distance_cm, r.current_a, r.rpm, r.pwm_command, r.mode,
                r.voltage_v, r.temperature_c, r.vibration_rms, r.pressure_bar,
                p.id as processed_id, p.current_rpm_ratio, p.current_zscore, p.rpm_zscore,
                p.mahalanobis_distance, p.distance_plausible, p.bucket_used, p.is_anomaly
            FROM raw_telemetry r
            LEFT JOIN processed_telemetry p ON p.raw_id = r.id
            WHERE (? IS NULL OR r.timestamp >= ?)
              AND r.machine_id = ?
            ORDER BY r.id DESC
            LIMIT ?
        """
        rows = db.query(sql, (since, since, machine_id, limit))
    else:
        sql = """
            SELECT
                r.id as raw_id, r.timestamp, r.car_id, r.machine_id, r.asset_type,
                r.distance_cm, r.current_a, r.rpm, r.pwm_command, r.mode,
                r.voltage_v, r.temperature_c, r.vibration_rms, r.pressure_bar,
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
    limit: int = Query(default=50, ge=1, le=200, description="Max traces to return"),
    machine_id: Optional[str] = Query(default=None, description="Filter by machine_id"),
):
    """Returns recent investigations grouped by trace ID."""
    if machine_id:
        sql = """
            SELECT
                trace_id, machine_id,
                MIN(timestamp) as started_at,
                MAX(timestamp) as completed_at,
                COUNT(*) as step_count,
                MAX(CASE WHEN step_type = 'diagnosis' THEN payload ELSE NULL END) as final_payload
            FROM investigations
            WHERE machine_id = ?
            GROUP BY trace_id
            ORDER BY started_at DESC
            LIMIT ?
        """
        traces = db.query(sql, (machine_id, limit))
    else:
        sql = """
            SELECT
                trace_id, machine_id,
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
            "machine_id": t.get("machine_id"),
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
        SELECT id, trace_id, machine_id, timestamp, step_type, payload
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
    use_stub = (
        config.USE_STUB
        or os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")
    )

    llm_reachable = False
    if not use_stub:
        try:
            with httpx.Client(timeout=1.0) as client:
                resp = client.get(f"{config.OLLAMA_URL}/api/tags")
                llm_reachable = (resp.status_code == 200)
        except Exception:
            llm_reachable = False

    raw_cnt = db.query("SELECT COUNT(*) as c FROM raw_telemetry")[0]["c"]
    proc_cnt = db.query("SELECT COUNT(*) as c FROM processed_telemetry")[0]["c"]
    inv_cnt = db.query("SELECT COUNT(*) as c FROM investigations")[0]["c"]

    return {
        "status": "ok",
        "llm_reachable": llm_reachable,
        "active_model": "ml_stub" if use_stub else config.OLLAMA_MODEL,
        "fallback_active": not llm_reachable or use_stub,
        "machines": machine_registry.summary(),
        "db_row_counts": {
            "raw_telemetry": raw_cnt,
            "processed_telemetry": proc_cnt,
            "investigations": inv_cnt,
        },
    }


@app.get("/api/machines")
def get_machines():
    """Returns the list of known machines and their current state summary."""
    return {"machines": machine_registry.summary()}


@app.get("/api/lifecycle")
def get_lifecycle():
    """Returns the diagnostic lifecycle state for all known machines (Phase 2)."""
    return {"lifecycles": diagnostic_lifecycle_registry.summary()}


@app.get("/api/lifecycle/{machine_id}")
def get_machine_lifecycle(machine_id: str):
    """Returns the diagnostic lifecycle state for a specific machine (Phase 2)."""
    lc = diagnostic_lifecycle_registry.get(machine_id)
    return lc.to_dict()


@app.get("/api/hypotheses")
def get_hypotheses():
    """Returns the engineering hypothesis catalog entries (Phase 2)."""
    from ml.hypothesis_scorer import get_catalog_hypotheses
    return {"hypotheses": get_catalog_hypotheses()}



# ---------------------------------------------------------------------------
# Backward-compat aliases for existing test_backend.py global-variable access
# ---------------------------------------------------------------------------
# The old tests reset global state via main.is_investigating, main.consecutive_anomalies etc.
# We expose module-level properties that delegate to a synthetic "default" machine slot
# (machine_id="car-01") so the test fixture's reset_backend_state() still works.

_DEFAULT_TEST_MACHINE_ID = "car-01"


def _default_machine() -> MachineState:
    return machine_registry.get(_DEFAULT_TEST_MACHINE_ID)


class _BackCompatProxy:
    """
    Descriptor-based proxy that makes module-level attribute access on main.py
    transparently read/write the default machine state, preserving the existing
    test fixture interface without any test changes.
    """

    @property  # type: ignore[override]
    def is_investigating(self) -> bool:
        return _default_machine().is_investigating

    @is_investigating.setter
    def is_investigating(self, v: bool) -> None:
        _default_machine().is_investigating = v

    @property
    def last_investigation_end_time(self) -> float:
        return _default_machine().last_investigation_end_time

    @last_investigation_end_time.setter
    def last_investigation_end_time(self, v: float) -> None:
        _default_machine().last_investigation_end_time = v

    @property
    def consecutive_anomalies(self) -> int:
        return _default_machine().consecutive_anomalies

    @consecutive_anomalies.setter
    def consecutive_anomalies(self, v: int) -> None:
        _default_machine().consecutive_anomalies = v

    @property
    def rolling_buffer(self):
        return _default_machine().rolling_buffer

    @property
    def _reading_seq(self) -> int:
        return _default_machine().reading_seq

    @_reading_seq.setter
    def _reading_seq(self, v: int) -> None:
        _default_machine().reading_seq = v


_proxy = _BackCompatProxy()

# Expose the backward-compat attributes at module level so existing tests work
import sys as _sys
_this_module = _sys.modules[__name__]


def __getattr__(name: str):
    if name in (
        "is_investigating",
        "last_investigation_end_time",
        "consecutive_anomalies",
        "rolling_buffer",
        "_reading_seq",
    ):
        return getattr(_proxy, name)
    raise AttributeError(f"module 'main' has no attribute {name!r}")


def __setattr__(name: str, value):
    if name in (
        "is_investigating",
        "last_investigation_end_time",
        "consecutive_anomalies",
        "_reading_seq",
    ):
        setattr(_proxy, name, value)
    else:
        object.__setattr__(_this_module, name, value)
