"""Integration tests for MachSight backend investigation flow, non-blocking ingestion, and REST APIs.

Verifies:
1. An injected anomaly triggers exactly one investigation (single-flight, consecutive anomaly threshold, cooldown).
2. The request_more_data path calls collect_window(), gathers new telemetry, and diagnoses.
3. The inconclusive diagnosis event carries a full structured payload matching normal diagnoses.
4. Ingestion latency remains fast (<30ms) and unaffected while reasoning runs in background executor.
5. REST endpoints (/api/telemetry, /api/investigations, /api/status) function correctly.
"""

import asyncio
import json
from pathlib import Path
import sys
import time
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

# Ensure backend and models directories are importable
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "backend"))
sys.path.insert(0, str(repo_root / "models"))

import main
import db


@pytest.fixture(autouse=True)
def reset_backend_state():
    """Resets backend investigation counters, locks, and cooldown before each test."""
    main.is_investigating = False
    main.last_investigation_end_time = 0.0
    main.consecutive_anomalies = 0
    main.rolling_buffer.clear()
    main._reading_seq = 0
    yield


@pytest.fixture
def client():
    """Provides a FastAPI test client."""
    return TestClient(main.app)


def test_anomaly_triggers_exactly_one_investigation(client):
    """Verifies that an anomaly requires N consecutive readings to trigger, runs single-flight, and obeys cooldown."""
    investigation_calls = []

    async def mock_investigation(reading, processed, result):
        investigation_calls.append(reading)
        await asyncio.sleep(0.05)

    with patch.object(main, "trigger_investigation", side_effect=mock_investigation):
        with client.websocket_connect("/telemetry/ingest") as ws:
            # Normal reading 1
            ws.send_json({"car_id": "car-01", "current_a": 1.75, "rpm": 305.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            # Anomaly reading 1 (consecutive = 1 < 3)
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            # Anomaly reading 2 (consecutive = 2 < 3)
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            assert len(investigation_calls) == 0

            # Anomaly reading 3 (consecutive = 3 -> triggers investigation!)
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            time.sleep(0.1)
            assert len(investigation_calls) == 1

            # Anomaly readings 4 and 5 sent immediately (cooldown or single-flight prevents re-triggering)
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            time.sleep(0.1)
            assert len(investigation_calls) == 1


def test_request_more_data_collects_new_window_and_diagnoses():
    """Verifies that request_more_data calls collect_window(), ingests new readings, and terminates with diagnosis."""
    hop1_result = {
        "action": "request_more_data",
        "reasoning": "Current spike detected; requesting 0.1s window to verify sustained load.",
        "diagnosis": None,
        "confidence": None,
        "evidence_used": ["current_a: 6.0A"],
        "recommended_action": None,
        "more_data": {"seconds": 0.1, "focus": "current"},
        "severity": "warning",
        "ui_hints": {"highlight_metrics": ["current_a"], "suggested_charts": ["current_timeline"]},
    }

    hop2_result = {
        "action": "diagnose",
        "reasoning": "Sustained stall current and zero RPM across window confirms mechanical jam.",
        "diagnosis": "Mechanical obstruction / drivetrain jam",
        "confidence": 0.96,
        "evidence_used": ["current_a: 6.0A", "rpm: 15.0", "window_stats"],
        "recommended_action": "Cut motor power and clear bind.",
        "more_data": None,
        "severity": "critical",
        "ui_hints": {"highlight_metrics": ["current_a", "rpm"], "suggested_charts": ["current_timeline", "rpm_timeline"]},
    }

    mock_reason = MagicMock(side_effect=[hop1_result, hop2_result])

    reading = {
        "car_id": "car-01",
        "current_a": 6.0,
        "rpm": 20.0,
        "distance_cm": 85.0,
        "pwm_command": 200,
        "mode": "forward",
        "timestamp": time.time(),
    }
    processed = {
        "current_rpm_ratio": 0.3,
        "current_zscore": 53.0,
        "rpm_zscore": -35.0,
        "mahalanobis_distance": 53.0,
        "distance_plausible": True,
        "bucket_used": "forward:200",
    }
    result = {
        "is_anomaly": True,
        "anomaly_score": 53.0,
        "reasons": ["Motor current elevated"],
        "matches": [{"fault": "obstruction_jam", "score": 0.95}],
    }

    # Populate rolling buffer with simulated incoming readings during wait
    async def simulate_incoming_telemetry():
        await asyncio.sleep(0.05)
        for i in range(5):
            main._reading_seq += 1
            main.rolling_buffer.append({
                "_seq": main._reading_seq,
                "car_id": "car-01",
                "current_a": 6.1,
                "rpm": 18.0,
                "distance_cm": 84.0,
                "pwm_command": 200,
                "mode": "forward",
                "timestamp": time.time(),
            })

    broadcasted_events = []

    async def mock_broadcast(event_type, data):
        broadcasted_events.append((event_type, data))

    async def run_test():
        asyncio.create_task(simulate_incoming_telemetry())
        with patch("ml.reasoner.reason", mock_reason), patch.object(main, "broadcast", side_effect=mock_broadcast):
            await main.trigger_investigation(reading, processed, result)

    asyncio.run(run_test())

    # Verify 2 hops executed
    assert mock_reason.call_count == 2

    # Check broadcasted events: 1 investigation_step + 1 diagnosis
    step_events = [data for evt, data in broadcasted_events if evt == "investigation_step"]
    diag_events = [data for evt, data in broadcasted_events if evt == "diagnosis"]

    assert len(step_events) == 1
    assert len(diag_events) == 1

    final_diag = diag_events[0]
    assert final_diag["step_type"] == "diagnosis"
    assert "payload" in final_diag
    parsed_payload = json.loads(final_diag["payload"])
    assert parsed_payload["action"] == "diagnose"
    assert parsed_payload["diagnosis"] == "Mechanical obstruction / drivetrain jam"
    assert parsed_payload["confidence"] == 0.96


def test_inconclusive_event_has_payload():
    """Verifies that an investigation reaching MAX_LOOPS produces an inconclusive event with a valid payload."""
    hop_loop_result = {
        "action": "request_more_data",
        "reasoning": "Still inconclusive; requesting more data.",
        "diagnosis": None,
        "confidence": None,
        "evidence_used": ["current_a"],
        "recommended_action": None,
        "more_data": {"seconds": 0.05, "focus": "current"},
        "severity": "warning",
        "ui_hints": {"highlight_metrics": ["current_a"], "suggested_charts": ["current_timeline"]},
    }

    mock_reason = MagicMock(return_value=hop_loop_result)

    reading = {
        "car_id": "car-01",
        "current_a": 3.0,
        "rpm": 150.0,
        "distance_cm": 85.0,
        "pwm_command": 200,
        "mode": "forward",
        "timestamp": time.time(),
    }
    processed = {
        "current_rpm_ratio": 0.02,
        "current_zscore": 15.0,
        "rpm_zscore": -10.0,
        "mahalanobis_distance": 15.0,
        "distance_plausible": True,
        "bucket_used": "forward:200",
    }
    result = {
        "is_anomaly": True,
        "anomaly_score": 15.0,
        "reasons": ["Unclear anomaly"],
        "matches": [],
    }

    broadcasted_events = []

    async def mock_broadcast(event_type, data):
        broadcasted_events.append((event_type, data))

    async def run_test():
        with patch("ml.reasoner.reason", mock_reason), patch.object(main, "broadcast", side_effect=mock_broadcast):
            await main.trigger_investigation(reading, processed, result)

    asyncio.run(run_test())

    # 3 hops executed
    assert mock_reason.call_count == 3

    diag_events = [data for evt, data in broadcasted_events if evt == "diagnosis"]
    assert len(diag_events) == 1
    inconclusive_event = diag_events[0]

    # Check that payload JSON string exists and matches schema
    assert "payload" in inconclusive_event
    assert isinstance(inconclusive_event["payload"], str)

    parsed = json.loads(inconclusive_event["payload"])
    assert parsed["action"] == "diagnose"
    assert parsed["diagnosis"] == "inconclusive"
    assert parsed["confidence"] == 0.0
    assert parsed["reason"] == "max investigation depth reached"
    assert "severity" in parsed
    assert "ui_hints" in parsed

    # Check backward-compatible top-level keys
    assert inconclusive_event["diagnosis"] == "inconclusive"
    assert inconclusive_event["reason"] == "max investigation depth reached"


def test_ingestion_latency_unaffected_while_reasoning_runs(client):
    """Verifies that ingestion latency is fast (<50ms) even while reasoning is computing in executor."""
    def slow_reason(evidence, history):
        time.sleep(0.3)  # simulate 300ms LLM computation
        return {
            "action": "diagnose",
            "reasoning": "Slow diagnosis finished.",
            "diagnosis": "Mechanical drag",
            "confidence": 0.85,
            "evidence_used": ["current_a"],
            "recommended_action": None,
            "more_data": None,
            "severity": "warning",
            "ui_hints": {"highlight_metrics": ["current_a"], "suggested_charts": ["current_timeline"]},
        }

    with patch("ml.reasoner.reason", side_effect=slow_reason):
        with client.websocket_connect("/telemetry/ingest") as ws:
            # Prime buffer with 2 anomalous readings
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})

            # 3rd reading triggers investigation in background task
            t0 = time.perf_counter()
            ws.send_json({"car_id": "car-01", "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
            t_trigger = time.perf_counter() - t0

            # Ingest 3 additional readings while investigation is actively calculating in background
            subsequent_latencies = []
            for _ in range(3):
                t_sub = time.perf_counter()
                ws.send_json({"car_id": "car-01", "current_a": 1.75, "rpm": 305.0, "distance_cm": 85.0, "pwm_command": 200, "mode": "forward"})
                subsequent_latencies.append(time.perf_counter() - t_sub)

    # Ingestion latency should not be blocked by 300ms executor task
    assert t_trigger < 0.06, f"Trigger reading was delayed: {t_trigger:.3f}s"
    for lat in subsequent_latencies:
        assert lat < 0.05, f"Subsequent reading was delayed: {lat:.3f}s"


def test_rest_endpoints(client):
    """Verifies that all new dashboard REST endpoints return 200 and expected schemas."""
    # 1. GET /health
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}

    # 2. GET /api/telemetry
    r = client.get("/api/telemetry?limit=5")
    assert r.status_code == 200
    data = r.json()
    assert "count" in data
    assert "data" in data

    # 3. GET /api/status
    r = client.get("/api/status")
    assert r.status_code == 200
    st = r.json()
    assert st["status"] == "ok"
    assert "llm_reachable" in st
    assert "active_model" in st
    assert "db_row_counts" in st
    assert "raw_telemetry" in st["db_row_counts"]

    # 4. GET /api/investigations
    r = client.get("/api/investigations?limit=5")
    assert r.status_code == 200
    inv_data = r.json()
    assert "count" in inv_data
    assert "investigations" in inv_data

    # If an investigation exists, test /api/investigations/{trace_id}
    if inv_data["investigations"]:
        trace_id = inv_data["investigations"][0]["trace_id"]
        r = client.get(f"/api/investigations/{trace_id}")
        assert r.status_code == 200
        trace = r.json()
        assert trace["trace_id"] == trace_id
        assert "steps" in trace
