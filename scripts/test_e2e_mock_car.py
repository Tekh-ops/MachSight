"""test_e2e_mock_car.py — End-to-end pytest with LLM mocked.

Tests that running mock_car.py --fault drag through the full FastAPI
pipeline produces a diagnosis event whose 'diagnosis' field reflects
mechanical drag (not a sensor fault, jam, or inconclusive).

The Ollama LLM is replaced with a deterministic mock that reflects the
expected reasoner output for drag evidence.  The rest of the pipeline runs
for real: mock_car telemetry generation → score_reading → classify →
build_evidence → trigger_investigation → DB insert → broadcast.

Tests in this file:
  1. test_drag_produces_drag_diagnosis      (primary E2E with mocked LLM)
  2. test_jam_produces_jam_diagnosis        (jam fault smoke test)
  3. test_sensor_fault_produces_sensor_diagnosis
  4. test_healthy_does_not_trigger_investigation
  5. test_drag_evidence_fields             (evidence dict content)
"""

import asyncio
import json
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Path bootstrap: ensure backend/ and models/ are importable
# ---------------------------------------------------------------------------
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "backend"))
sys.path.insert(0, str(repo_root / "models"))

import main
from scripts.mock_car import MockCar  # noqa: E402  (after sys.path setup)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_state():
    """Reset all backend globals between tests."""
    main.is_investigating = False
    main.last_investigation_end_time = 0.0
    main.consecutive_anomalies = 0
    main.rolling_buffer.clear()
    main._reading_seq = 0
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_drag_reasoner_response(evidence: dict) -> dict:
    """Deterministic drag-diagnosis response based on evidence keys."""
    current = evidence.get("current_a", 0)
    rpm = evidence.get("rpm", 0)
    return {
        "action": "diagnose",
        "reasoning": (
            f"Motor current ({current:.2f}A) is significantly elevated with a "
            f"reduced but non-zero RPM ({rpm:.1f}), consistent with mechanical "
            "drag from drivetrain friction."
        ),
        "diagnosis": "Mechanical drag / drivetrain friction",
        "confidence": 0.88,
        "evidence_used": ["current_a", "rpm", "current_zscore"],
        "recommended_action": "Inspect wheel bearings and drivetrain for binding.",
        "more_data": None,
        "severity": "warning",
        "ui_hints": {
            "highlight_metrics": ["current_a", "rpm"],
            "suggested_charts": ["current_timeline", "rpm_timeline"],
        },
    }


def _make_jam_reasoner_response(evidence: dict) -> dict:
    return {
        "action": "diagnose",
        "reasoning": "Stall current with near-zero RPM and clear path confirms mechanical jam.",
        "diagnosis": "Mechanical obstruction / drivetrain jam",
        "confidence": 0.95,
        "evidence_used": ["current_a", "rpm", "distance_cm"],
        "recommended_action": "Cut motor power and clear obstruction.",
        "more_data": None,
        "severity": "critical",
        "ui_hints": {"highlight_metrics": ["current_a", "rpm"], "suggested_charts": ["current_timeline"]},
    }


def _make_sensor_fault_response(evidence: dict) -> dict:
    return {
        "action": "diagnose",
        "reasoning": "Out-of-range or frozen distance reading while motor is healthy.",
        "diagnosis": "Ultrasonic distance sensor fault",
        "confidence": 0.92,
        "evidence_used": ["distance_cm"],
        "recommended_action": "Replace or recalibrate the ultrasonic sensor.",
        "more_data": None,
        "severity": "warning",
        "ui_hints": {"highlight_metrics": ["distance_cm"], "suggested_charts": ["distance_timeline"]},
    }


def _generate_fault_readings(fault: str, count: int = 30, rng_seed: int = 42) -> list:
    """Use MockCar to generate `count` fault-phase readings (skipping healthy phase)."""
    import random
    rng = random.Random(rng_seed)
    car = MockCar(
        mode="forward",
        pwm=200,
        fault=fault,
        start_fault_after=0.0,  # immediately in fault phase
        rng=rng,
    )
    # Force fault phase by backdating start_time
    car.start_time = time.time() - 999.0
    return [car.next_reading() for _ in range(count)]


async def _pump_readings_through_backend(
    readings: list,
    mode: str = "forward",
    pwm: int = 200,
) -> list[tuple]:
    """
    Send pre-generated readings directly through the backend analysis pipeline
    (bypassing the WS socket) to collect broadcast events.

    Returns list of (event_type, data) tuples.
    """
    broadcasted = []

    async def capture_broadcast(event_type: str, data: dict):
        broadcasted.append((event_type, data))

    for r in readings:
        payload = {
            "car_id": "car-01",
            "timestamp": time.time(),
            "mode": mode,
            "pwm_command": pwm,
            **r,
        }
        main._reading_seq += 1
        payload["_seq"] = main._reading_seq
        main.rolling_buffer.append(payload)

    return broadcasted


# ---------------------------------------------------------------------------
# Test 1: Drag fault → drag diagnosis
# ---------------------------------------------------------------------------

def test_drag_produces_drag_diagnosis():
    """E2E: mock_car drag readings → anomaly detection → mocked LLM → drag diagnosis."""
    drag_readings = _generate_fault_readings("drag", count=50)

    # Find the first reading that is anomalous (high current)
    # For drag, current is ~2.7A; baseline forward:200 is 1.75A ± 0.075 → z ~ 12
    # So the very first drag reading should be anomalous.
    # Use the 20th reading (fully ramped drag).
    reading = {
        "car_id": "car-01",
        "timestamp": time.time(),
        "mode": "forward",
        "pwm_command": 200,
        **drag_readings[20],
    }

    # Build processed features from real pipeline
    from ml.pipeline import analyze
    window = [
        {"car_id": "car-01", "mode": "forward", "pwm_command": 200, "timestamp": time.time(), **r}
        for r in drag_readings[:20]
    ]
    analysis = analyze(raw=reading, recent_window=window, reference=main.REFERENCE)
    processed = analysis["processed"]
    matches = analysis["matches"]
    is_anomaly = analysis["is_anomaly"]

    # Confirm the pipeline recognises this as anomalous
    assert is_anomaly, (
        f"Expected drag reading to be anomalous. "
        f"current_a={reading['current_a']:.3f}, "
        f"current_zscore={processed.get('current_zscore', 'N/A')}"
    )

    result = {
        "is_anomaly": True,
        "anomaly_score": processed["mahalanobis_distance"],
        "reasons": processed.get("reasons", []),
        "matches": matches,
    }

    broadcasted = []

    async def capture(event_type, data):
        broadcasted.append((event_type, data))

    mock_reason = MagicMock(side_effect=lambda ev, hist: _make_drag_reasoner_response(ev))

    async def run():
        with patch("ml.reasoner.reason", mock_reason), patch.object(main, "broadcast", side_effect=capture):
            await main.trigger_investigation(reading, processed, result)

    asyncio.run(run())

    # Assert both preliminary and final diagnosis were emitted
    diag_events = [data for evt, data in broadcasted if evt == "diagnosis"]
    assert len(diag_events) == 2, f"Expected 2 diagnosis events (preliminary + final), got {len(diag_events)}"

    prelim = json.loads(diag_events[0]["payload"])
    assert prelim["stage"] == "preliminary"
    assert prelim["action"] == "diagnose"
    assert "drag" in prelim["diagnosis"].lower() or "friction" in prelim["diagnosis"].lower()

    diag = diag_events[1]
    assert diag["step_type"] == "diagnosis"
    assert "payload" in diag

    parsed = json.loads(diag["payload"])
    assert parsed["action"] == "diagnose"
    assert parsed["stage"] == "final"

    # The diagnosis should mention drag (not jam, sensor_fault, or inconclusive)
    diagnosis_lower = parsed["diagnosis"].lower()
    assert "drag" in diagnosis_lower or "friction" in diagnosis_lower, (
        f"Expected drag-related diagnosis, got: {parsed['diagnosis']!r}"
    )
    assert parsed["confidence"] >= 0.5, f"Confidence too low: {parsed['confidence']}"
    assert mock_reason.call_count >= 1


# ---------------------------------------------------------------------------
# Test 2: Jam fault → jam diagnosis
# ---------------------------------------------------------------------------

def test_jam_produces_jam_diagnosis():
    """E2E: mock_car jam readings → anomaly → mocked LLM → jam diagnosis."""
    jam_readings = _generate_fault_readings("jam", count=10)
    reading = {
        "car_id": "car-01",
        "timestamp": time.time(),
        "mode": "forward",
        "pwm_command": 200,
        **jam_readings[0],
    }

    from ml.pipeline import analyze
    analysis = analyze(raw=reading, recent_window=[], reference=main.REFERENCE)
    processed = analysis["processed"]
    assert analysis["is_anomaly"], (
        f"Expected jam to be anomalous: current={reading['current_a']}, "
        f"current_zscore={processed.get('current_zscore')}"
    )

    result = {
        "is_anomaly": True,
        "anomaly_score": processed["mahalanobis_distance"],
        "reasons": processed.get("reasons", []),
        "matches": analysis["matches"],
    }

    broadcasted = []

    async def capture(event_type, data):
        broadcasted.append((event_type, data))

    mock_reason = MagicMock(side_effect=lambda ev, hist: _make_jam_reasoner_response(ev))

    async def run():
        with patch("ml.reasoner.reason", mock_reason), patch.object(main, "broadcast", side_effect=capture):
            await main.trigger_investigation(reading, processed, result)

    asyncio.run(run())

    diag_events = [data for evt, data in broadcasted if evt == "diagnosis"]
    assert len(diag_events) == 2, f"Expected 2 diagnosis events (preliminary + final), got {len(diag_events)}"
    assert json.loads(diag_events[0]["payload"])["stage"] == "preliminary"

    parsed = json.loads(diag_events[1]["payload"])
    assert parsed["stage"] == "final"
    assert "jam" in parsed["diagnosis"].lower() or "obstruction" in parsed["diagnosis"].lower()
    assert parsed["confidence"] >= 0.8


# ---------------------------------------------------------------------------
# Test 3: Sensor fault → sensor diagnosis
# ---------------------------------------------------------------------------

def test_sensor_fault_produces_sensor_diagnosis():
    """E2E: out-of-range distance reading → anomaly → mocked LLM → sensor diagnosis.

    We use a hardcoded out-of-range distance rather than relying on a particular
    random seed branch (the RNG may produce frozen or out-of-range in any order).
    """
    # Force an explicitly out-of-range distance value (above 400 cm)
    reading = {
        "car_id": "car-01",
        "timestamp": time.time(),
        "mode": "forward",
        "pwm_command": 200,
        "current_a": 1.75,   # healthy motor
        "rpm": 303.0,         # healthy rpm
        "distance_cm": 450.0, # sensor out-of-range (> 400 cm)
    }

    from ml.pipeline import analyze
    analysis = analyze(raw=reading, recent_window=[], reference=main.REFERENCE)
    processed = analysis["processed"]
    assert analysis["is_anomaly"], (
        f"Out-of-range distance should flag anomaly. "
        f"distance_plausible={processed.get('distance_plausible')}"
    )

    # Verify sensor_fault is the top match
    top_match = analysis["matches"][0]
    assert top_match["fault"] == "sensor_fault", (
        f"Expected sensor_fault as top match, got {top_match['fault']}"
    )

    result = {
        "is_anomaly": True,
        "anomaly_score": processed["mahalanobis_distance"],
        "reasons": processed.get("reasons", []),
        "matches": analysis["matches"],
    }

    broadcasted = []

    async def capture(event_type, data):
        broadcasted.append((event_type, data))

    mock_reason = MagicMock(side_effect=lambda ev, hist: _make_sensor_fault_response(ev))

    async def run():
        with patch("ml.reasoner.reason", mock_reason), patch.object(main, "broadcast", side_effect=capture):
            await main.trigger_investigation(reading, processed, result)

    asyncio.run(run())

    diag_events = [data for evt, data in broadcasted if evt == "diagnosis"]
    assert len(diag_events) == 2, f"Expected 2 diagnosis events (preliminary + final), got {len(diag_events)}"
    assert json.loads(diag_events[0]["payload"])["stage"] == "preliminary"

    parsed = json.loads(diag_events[1]["payload"])
    assert parsed["stage"] == "final"
    assert "sensor" in parsed["diagnosis"].lower()
    assert parsed["confidence"] >= 0.8


# ---------------------------------------------------------------------------
# Test 4: Healthy readings do not trigger investigation
# ---------------------------------------------------------------------------

def test_healthy_does_not_trigger_investigation():
    """Healthy readings should not trigger an investigation (is_anomaly=False)."""
    import random
    rng = random.Random(0)
    car = MockCar(mode="forward", pwm=200, fault="none", start_fault_after=999.0, rng=rng)
    car.start_time = time.time()

    healthy_readings = [car.next_reading() for _ in range(5)]

    from ml.pipeline import analyze

    mock_trigger = MagicMock()
    investigation_triggered = False

    for r in healthy_readings:
        reading = {"car_id": "car-01", "timestamp": time.time(), "mode": "forward", "pwm_command": 200, **r}
        analysis = analyze(raw=reading, recent_window=[], reference=main.REFERENCE)
        if analysis["is_anomaly"]:
            investigation_triggered = True

    assert not investigation_triggered, (
        "Healthy readings should not be anomalous. "
        "Check reference.pkl baselines or mock_car noise levels."
    )


# ---------------------------------------------------------------------------
# Test 5: Drag evidence contains expected fields
# ---------------------------------------------------------------------------

def test_drag_evidence_fields():
    """Drag fault readings produce evidence dicts with expected structure.

    build_evidence() uses a nested schema:
      evidence["telemetry"]["current_a"], evidence["anomaly"]["score"], etc.
    This test validates both structure and drag-specific characteristics.
    """
    drag_readings = _generate_fault_readings("drag", count=30)
    reading = {
        "car_id": "car-01",
        "timestamp": time.time(),
        "mode": "forward",
        "pwm_command": 200,
        **drag_readings[20],
    }
    window = [
        {"car_id": "car-01", "mode": "forward", "pwm_command": 200, "timestamp": time.time(), **r}
        for r in drag_readings[:20]
    ]

    from ml.pipeline import analyze, build_evidence
    analysis = analyze(raw=reading, recent_window=window, reference=main.REFERENCE)
    processed = analysis["processed"]
    matches = analysis["matches"]

    evidence = build_evidence(
        raw=reading,
        processed=processed,
        matches=matches,
        window=None,
    )

    # Top-level structural keys (build_evidence nested schema)
    for key in ("car_id", "mode", "pwm", "bucket", "telemetry", "anomaly", "top_matches"):
        assert key in evidence, f"Missing top-level key in evidence: {key!r}"

    tel = evidence["telemetry"]
    anom = evidence["anomaly"]

    # Nested telemetry keys
    for key in ("current_a", "current_baseline", "current_z",
                 "rpm", "rpm_baseline", "rpm_z",
                 "ratio", "distance_cm", "distance_plausible"):
        assert key in tel, f"Missing telemetry key: {key!r}"

    # Anomaly block
    for key in ("is_anomaly", "score", "reasons"):
        assert key in anom, f"Missing anomaly key: {key!r}"

    # Drag characteristics: elevated current, non-zero rpm
    assert tel["current_a"] > 1.753 * 1.2, (
        f"Expected elevated current in drag, got {tel['current_a']:.3f}"
    )
    assert tel["rpm"] > 10.0, (
        f"Expected non-zero RPM in drag (distinguishes from jam), got {tel['rpm']:.1f}"
    )
    assert tel["current_z"] > 2.0, (
        f"Expected positive current z-score for drag, got {tel['current_z']:.2f}"
    )
    assert anom["is_anomaly"] is True
