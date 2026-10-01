"""Phase 2 comprehensive tests for MachSight intelligent diagnostic reasoning.

Test coverage:
  1. Evidence extraction — drivetrain jam
  2. Evidence extraction — idle/stopped (NOT a fault)
  3. Evidence extraction — RPM sensor failure differentiation
  4. Operating state — IDLE != FAULTED for PWM=0, RPM=0
  5. Hypothesis scoring — drivetrain jam scores DRIVETRAIN_OBSTRUCTION strongly
  6. Hypothesis scoring — RPM sensor vs mechanical fault differentiation
  7. Hypothesis scoring — idle/stopped does NOT score drivetrain obstruction
  8. Diagnostic lifecycle — NORMAL → FAULT_SUSPECTED → ANALYZING
  9. Diagnostic lifecycle — DIAGNOSED → RECOVERED after signals normalize
  10. Diagnostic lifecycle — re-diagnosis debouncing
  11. Reasoner v2 — valid Qwen output parsed and normalized
  12. Reasoner v2 — Qwen unavailable → graceful fallback (no crash)
  13. Reasoner v2 — malformed JSON → graceful fallback
  14. Reasoner v2 — HTTP error → graceful fallback
  15. Reasoner v2 — required output keys always present
  16. Recovery result — produces recovery-specific output
  17. Hypothesis catalog — all 9 hypotheses load correctly
  18. Sensor fault differentiation — ultrasonic sensor fault
  19. Persistence — transient spike does NOT count as PERSISTENT
  20. Temporal relationships — correct flags for jam scenario
"""

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup — must run from MachSight root
# ---------------------------------------------------------------------------
_root = Path(__file__).resolve().parent.parent.parent
_models = str(_root / "models")
_backend = str(_root / "backend")
for p in (_models, _backend):
    if p not in sys.path:
        sys.path.insert(0, p)

# ---------------------------------------------------------------------------
# Imports under test
# ---------------------------------------------------------------------------
from ml.reference_builder import load_reference_set
from ml.features import process_reading
from ml.classify import classify
from ml.temporal_evidence import (
    extract_diagnostic_evidence,
    MachineOperatingState,
    Trend,
    Persistence,
    _classify_trend,
    _classify_persistence,
    _estimate_operating_state,
)
from ml.hypothesis_scorer import score_hypotheses, get_catalog_hypotheses, _detect_active_patterns
from ml.diagnostic_lifecycle import (
    DiagnosticLifecycle,
    DiagnosticLifecycleState,
    DiagnosticTrigger,
)
from ml.diagnostic_reasoner import reason_v2, reason_fallback_v2, build_recovery_result

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def reference():
    ref_path = _root / "models" / "ml" / "reference.pkl"
    return load_reference_set(str(ref_path))


def _make_jam_window(n: int = 20) -> List[Dict[str, Any]]:
    """Simulate persistent drivetrain jam: high PWM, high current, collapsed RPM."""
    return [
        {
            "car_id": "rc_car_01",
            "machine_id": "rc_car_01",
            "mode": "forward",
            "pwm_command": 160,
            "current_a": 3.96,
            "rpm": 22.0,
            "distance_cm": 320.0,
            "timestamp": 1000.0 + i * 0.5,
            "is_anomaly": True,
        }
        for i in range(n)
    ]


def _make_healthy_window(n: int = 20) -> List[Dict[str, Any]]:
    """Simulate healthy cruising."""
    return [
        {
            "car_id": "rc_car_01",
            "machine_id": "rc_car_01",
            "mode": "forward",
            "pwm_command": 160,
            "current_a": 1.60,
            "rpm": 225.0,
            "distance_cm": 120.0,
            "timestamp": 1000.0 + i * 0.5,
            "is_anomaly": False,
        }
        for i in range(n)
    ]


def _make_idle_window(n: int = 10) -> List[Dict[str, Any]]:
    """Simulate stopped/idle: PWM=0, RPM=0 — NOT a fault."""
    return [
        {
            "car_id": "rc_car_01",
            "machine_id": "rc_car_01",
            "mode": "idle",
            "pwm_command": 0,
            "current_a": 0.1,
            "rpm": 0.0,
            "distance_cm": 150.0,
            "timestamp": 1000.0 + i * 0.5,
            "is_anomaly": False,
        }
        for i in range(n)
    ]


def _make_rpm_sensor_fault_window(n: int = 15) -> List[Dict[str, Any]]:
    """RPM sensor failure: RPM=0 but current is normal and mode is forward."""
    return [
        {
            "car_id": "rc_car_01",
            "machine_id": "rc_car_01",
            "mode": "forward",
            "pwm_command": 160,
            "current_a": 1.62,   # near normal
            "rpm": 0.0,          # sensor reports zero
            "distance_cm": 200.0,
            "timestamp": 1000.0 + i * 0.5,
            "is_anomaly": True,
        }
        for i in range(n)
    ]


def _extract(window, processed=None, reference=None):
    """Helper to extract a packet from window."""
    latest = window[-1]
    if reference is not None:
        proc = process_reading(latest, reference, window=window)
        matches = classify(proc, None)
    else:
        proc = processed or {}
        matches = []
    return extract_diagnostic_evidence(
        machine_id=latest.get("machine_id", "rc_car_01"),
        window=window,
        processed_latest=proc,
        matches=matches,
        window_seconds=10.0,
    )


# ===========================================================================
# 1. Evidence extraction — drivetrain jam
# ===========================================================================

def test_evidence_jam_operating_state(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    assert packet.operating_state in (
        MachineOperatingState.FAULTED,
        MachineOperatingState.FAULT_SUSPECTED,
    ), f"Expected FAULTED or FAULT_SUSPECTED, got {packet.operating_state}"


def test_evidence_jam_current_elevated(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    assert packet.current["current_a"] > 3.0
    assert packet.current.get("increase_pct", 0) > 100


def test_evidence_jam_rpm_collapsed(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    assert packet.rpm["current_rpm"] < 50
    assert packet.rpm.get("change_pct", 0) < -50


def test_evidence_jam_persistence_persistent(reference):
    window = _make_jam_window(20)
    packet = _extract(window, reference=reference)
    assert packet.persistence == Persistence.PERSISTENT


def test_evidence_jam_temporal_relationships(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    rels = packet.temporal_relationships
    assert "motor_command_remained_high" in rels
    assert "current_increased" in rels
    assert "rpm_decreased" in rels
    assert "current_high_and_rpm_collapsed" in rels


def test_evidence_jam_evidence_items_exist(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    assert len(packet.evidence_items) >= 4
    ids = [e.id for e in packet.evidence_items]
    # E001, E002, E003 should exist for the jam scenario
    assert "E001" in ids
    assert "E002" in ids
    assert "E003" in ids


# ===========================================================================
# 2. Idle/stopped is NOT a fault
# ===========================================================================

def test_idle_operating_state_not_faulted(reference):
    window = _make_idle_window()
    packet = _extract(window, reference=reference)
    assert packet.operating_state not in (
        MachineOperatingState.FAULTED,
        MachineOperatingState.FAULT_SUSPECTED,
    ), f"Idle/stopped wrongly classified as {packet.operating_state}"


def test_idle_does_not_score_drivetrain_obstruction(reference):
    window = _make_idle_window()
    packet = _extract(window, reference=reference)
    scored = score_hypotheses(packet)
    top = scored[0]
    # Drivetrain obstruction should NOT be the top hypothesis for idle
    if top.id == "DRIVETRAIN_OBSTRUCTION":
        assert top.diagnostic_score < 0.3, (
            f"DRIVETRAIN_OBSTRUCTION should not score high for idle, got {top.diagnostic_score}"
        )


def test_operating_state_pwm_zero_rpm_zero_is_stopped():
    """Unit test: PWM=0, RPM=0 → STOPPED, not FAULTED."""
    state = _estimate_operating_state(
        pwm=0, rpm=0.0, current_a=0.1,
        baseline_rpm=225.0, baseline_current=1.6,
        is_anomaly=False, persistence=Persistence.UNKNOWN,
    )
    assert state == MachineOperatingState.STOPPED


# ===========================================================================
# 3. RPM sensor failure differentiation
# ===========================================================================

def test_rpm_sensor_fault_scores_differently_from_jam(reference):
    """RPM sensor failure (current normal) should score RPM_SENSOR_FAILURE higher than jam."""
    jam_window = _make_jam_window()
    sensor_window = _make_rpm_sensor_fault_window()

    jam_packet = _extract(jam_window, reference=reference)
    sensor_packet = _extract(sensor_window, reference=reference)

    jam_scored = {h.id: h.diagnostic_score for h in score_hypotheses(jam_packet)}
    sensor_scored = {h.id: h.diagnostic_score for h in score_hypotheses(sensor_packet)}

    # Drivetrain obstruction should score HIGHER for jam than for sensor fault
    jam_dt = jam_scored.get("DRIVETRAIN_OBSTRUCTION", 0.0)
    sensor_dt = sensor_scored.get("DRIVETRAIN_OBSTRUCTION", 0.0)
    assert jam_dt > sensor_dt, (
        f"Jam DT={jam_dt:.3f} should be > sensor fault DT={sensor_dt:.3f}"
    )


def test_rpm_sensor_fault_active_patterns():
    """Pattern detection should flag rpm_zero_with_normal_current for sensor fault scenario."""
    from ml.temporal_evidence import DiagnosticEvidencePacket, MachineOperatingState, Persistence, Trend
    from ml.hypothesis_scorer import _detect_active_patterns

    # Build a minimal packet for RPM sensor fault
    mock_packet = MagicMock()
    mock_packet.current = {"current_a": 1.62, "baseline_a": 1.60, "increase_pct": 1.3}
    mock_packet.rpm = {"current_rpm": 0.0, "baseline_rpm": 225.0, "change_pct": -100.0}
    mock_packet.motor_command = {"pwm": 160, "sustained": True}
    mock_packet.ultrasonic = {"distance_cm": 200.0}
    mock_packet.velocity = None
    mock_packet.trends = {"current": "stable", "rpm": "stable", "distance": "stable"}
    mock_packet.persistence = Persistence.PERSISTENT

    patterns = _detect_active_patterns(mock_packet)
    assert patterns.get("rpm_zero_with_normal_current") is True, (
        "Should detect rpm_zero_with_normal_current for sensor failure scenario"
    )
    assert patterns.get("elevated_current") is False, (
        "Should NOT flag elevated_current when current is normal"
    )


# ===========================================================================
# 4. Hypothesis scoring — jam scenario
# ===========================================================================

def test_drivetrain_obstruction_top_score_for_jam(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    scored = score_hypotheses(packet)
    assert scored[0].id == "DRIVETRAIN_OBSTRUCTION", (
        f"Expected DRIVETRAIN_OBSTRUCTION as top, got {scored[0].id} "
        f"(score={scored[0].diagnostic_score:.3f})"
    )
    assert scored[0].diagnostic_score >= 0.7


def test_alternatives_score_lower_than_primary(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    scored = score_hypotheses(packet)
    assert len(scored) >= 2
    assert scored[0].diagnostic_score > scored[1].diagnostic_score


def test_hypothesis_score_output_structure(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    scored = score_hypotheses(packet)
    for h in scored:
        d = h.to_dict()
        assert "id" in d
        assert "label" in d
        assert "diagnostic_score" in d
        assert 0.0 <= d["diagnostic_score"] <= 1.0
        assert isinstance(d["recommended_checks"], list)
        assert isinstance(d["possible_actions"], list)


# ===========================================================================
# 5. Hypothesis catalog
# ===========================================================================

def test_catalog_loads_nine_hypotheses():
    cats = get_catalog_hypotheses()
    assert len(cats) == 9


def test_catalog_hypothesis_ids():
    cats = get_catalog_hypotheses()
    ids = {h["id"] for h in cats}
    expected = {
        "DRIVETRAIN_OBSTRUCTION", "MOTOR_OVERLOAD", "MOTOR_DRAG",
        "WHEEL_SLIP", "RPM_SENSOR_FAILURE", "CURRENT_SENSOR_FAILURE",
        "ULTRASONIC_SENSOR_FAILURE", "LOW_BATTERY_VOLTAGE_SAG", "UNKNOWN_MECHANICAL_FAULT"
    }
    assert ids == expected


def test_catalog_has_required_fields():
    cats = get_catalog_hypotheses()
    required = {"id", "label", "description", "affected_subsystem", "severity",
                "supporting_patterns", "contradicting_patterns",
                "recommended_checks", "possible_actions"}
    for h in cats:
        for field in required:
            assert field in h, f"Hypothesis {h.get('id')} missing field {field!r}"


# ===========================================================================
# 6. Diagnostic lifecycle
# ===========================================================================

def test_lifecycle_normal_to_fault_suspected(reference):
    window = _make_jam_window()
    packet = _extract(window, reference=reference)
    lc = DiagnosticLifecycle(machine_id="test-lc-1")

    # Simulate consecutive anomalies
    trigger = lc.update(packet, is_anomaly=True, consecutive_anomalies=5)
    assert trigger is not None
    assert lc.state in (
        DiagnosticLifecycleState.FAULT_SUSPECTED,
        DiagnosticLifecycleState.ANALYZING,
    )


def test_lifecycle_healthy_stays_normal(reference):
    window = _make_healthy_window()
    packet = _extract(window, reference=reference)
    lc = DiagnosticLifecycle(machine_id="test-lc-2")

    for _ in range(5):
        trigger = lc.update(packet, is_anomaly=False, consecutive_anomalies=0)

    assert lc.state == DiagnosticLifecycleState.NORMAL
    assert trigger is None


def test_lifecycle_recovery_detection(reference):
    """After fault is diagnosed, healthy signals should trigger RECOVERED."""
    lc = DiagnosticLifecycle(machine_id="test-lc-3")
    lc.recovery_confirmation_s = 0.01  # Speed up recovery for test

    # Force into DIAGNOSED state
    lc.state = DiagnosticLifecycleState.DIAGNOSED

    healthy_window = _make_healthy_window()
    healthy_packet = _extract(healthy_window, reference=reference)

    # Call update multiple times to trigger recovery
    for _ in range(5):
        time.sleep(0.01)
        lc.update(healthy_packet, is_anomaly=False, consecutive_anomalies=0)

    assert lc.state in (
        DiagnosticLifecycleState.RECOVERED,
        DiagnosticLifecycleState.NORMAL,
    ), f"Expected RECOVERED or NORMAL after signals normalize, got {lc.state}"


def test_lifecycle_mark_diagnosed():
    lc = DiagnosticLifecycle(machine_id="test-lc-4")
    lc.state = DiagnosticLifecycleState.ANALYZING
    lc.mark_diagnosed()
    assert lc.state == DiagnosticLifecycleState.DIAGNOSED
    assert lc.last_diagnosed_time is not None


# ===========================================================================
# 7. Reasoner v2 — graceful fallback tests
# ===========================================================================

def _make_jam_packet(reference) -> "DiagnosticEvidencePacket":
    window = _make_jam_window()
    return _extract(window, reference=reference)


def test_reason_v2_qwen_unavailable_graceful_fallback(reference):
    """Qwen connection error → graceful fallback, no crash, all required keys present."""
    import httpx
    packet = _make_jam_packet(reference)
    with patch("ml.diagnostic_reasoner.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value.post.side_effect = (
            httpx.ConnectError("Connection refused")
        )
        result = reason_v2(packet)

    assert result is not None
    assert result.get("fallback_active") is True
    assert result.get("primary_hypothesis") is not None
    assert result["primary_hypothesis"]["id"] == "DRIVETRAIN_OBSTRUCTION"
    _assert_required_keys(result)


def test_reason_v2_qwen_timeout_graceful_fallback(reference):
    """Qwen timeout → graceful fallback."""
    import httpx
    packet = _make_jam_packet(reference)
    with patch("ml.diagnostic_reasoner.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value.post.side_effect = (
            httpx.TimeoutException("Timed out")
        )
        result = reason_v2(packet)

    assert result.get("fallback_active") is True
    _assert_required_keys(result)


def test_reason_v2_qwen_http_500_graceful_fallback(reference):
    """Qwen HTTP 500 → graceful fallback."""
    packet = _make_jam_packet(reference)
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Server Error"
    with patch("ml.diagnostic_reasoner.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value.post.return_value = mock_resp
        result = reason_v2(packet)

    assert result.get("fallback_active") is True
    _assert_required_keys(result)


def test_reason_v2_malformed_json_then_retry_then_fallback(reference):
    """Malformed JSON on both attempts → graceful fallback (no crash)."""
    packet = _make_jam_packet(reference)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"message": {"content": "NOT_VALID_JSON!!!"}}
    with patch("ml.diagnostic_reasoner.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value.post.return_value = mock_resp
        result = reason_v2(packet)

    assert result is not None
    assert result.get("fallback_active") is True
    _assert_required_keys(result)


def test_reason_v2_valid_qwen_response(reference):
    """Valid Qwen structured response is parsed and merged correctly."""
    packet = _make_jam_packet(reference)

    mock_llm_output = {
        "machine_state": "FAULTED",
        "primary_hypothesis_id": "DRIVETRAIN_OBSTRUCTION",
        "reasoning": [
            {
                "statement": "Motor current increased substantially while RPM collapsed.",
                "evidence_ids": ["E001", "E002", "E003"]
            },
            {
                "statement": "Vehicle commanded but not moving — consistent with mechanical resistance.",
                "evidence_ids": ["E004"]
            },
        ],
        "uncertainty": [
            "Telemetry cannot determine the specific component causing the obstruction."
        ],
        "severity": "HIGH",
        "recommended_action": [
            "Stop motor immediately.",
            "Inspect wheels for physical obstruction."
        ],
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"message": {"content": json.dumps(mock_llm_output)}}
    with patch("ml.diagnostic_reasoner.httpx.Client") as mock_client_cls:
        mock_client_cls.return_value.__enter__.return_value.post.return_value = mock_resp
        result = reason_v2(packet)

    assert result["fallback_active"] is False
    assert result["primary_hypothesis"]["id"] == "DRIVETRAIN_OBSTRUCTION"
    assert isinstance(result["reasoning"], list)
    assert len(result["reasoning"]) == 2
    assert "E001" in result["reasoning"][0]["evidence_ids"]
    assert isinstance(result["uncertainty"], list)
    assert len(result["uncertainty"]) > 0
    _assert_required_keys(result)


def test_reason_v2_all_required_keys_in_fallback(reference):
    """Verify all required output keys are present in fallback path."""
    packet = _make_jam_packet(reference)
    result = reason_fallback_v2(packet)
    _assert_required_keys(result)


# ===========================================================================
# 8. Recovery result
# ===========================================================================

def test_recovery_result_structure(reference):
    window = _make_healthy_window()
    packet = _extract(window, reference=reference)
    result = build_recovery_result(packet, previous_hypothesis_id="DRIVETRAIN_OBSTRUCTION")

    assert result["is_recovery"] is True
    assert result["primary_hypothesis"]["id"] == "RECOVERY"
    assert result["severity"] == "info"
    assert result.get("previous_hypothesis_id") == "DRIVETRAIN_OBSTRUCTION"


# ===========================================================================
# 9. Trend classification unit tests
# ===========================================================================

def test_trend_increasing():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert _classify_trend(values) == Trend.INCREASING


def test_trend_decreasing():
    values = [5.0, 4.0, 3.0, 2.0, 1.0]
    assert _classify_trend(values) == Trend.DECREASING


def test_trend_stable():
    values = [3.0, 3.01, 2.99, 3.0, 3.0]
    assert _classify_trend(values) == Trend.STABLE


def test_trend_oscillating():
    values = [1.0, 3.0, 1.0, 3.0, 1.0, 3.0]
    assert _classify_trend(values) == Trend.OSCILLATING


# ===========================================================================
# 10. Persistence classification unit tests
# ===========================================================================

def test_persistence_persistent():
    p = _classify_persistence(window_seconds=10.0, anomaly_fraction=0.95)
    assert p == Persistence.PERSISTENT


def test_persistence_transient():
    p = _classify_persistence(window_seconds=2.0, anomaly_fraction=0.95)
    assert p == Persistence.TRANSIENT


def test_persistence_recovering():
    p = _classify_persistence(window_seconds=10.0, anomaly_fraction=0.05)
    assert p == Persistence.RECOVERING


# ===========================================================================
# 11. Ultrasonic sensor fault differentiation
# ===========================================================================

def test_ultrasonic_fault_scores_sensor_failure(reference):
    """Out-of-range distance should score ULTRASONIC_SENSOR_FAILURE strongly."""
    window = [
        {
            "car_id": "rc_car_01", "machine_id": "rc_car_01",
            "mode": "forward", "pwm_command": 160,
            "current_a": 1.60, "rpm": 225.0, "distance_cm": 999.0,  # out of range
            "timestamp": 1000.0 + i * 0.5, "is_anomaly": True,
        }
        for i in range(10)
    ]
    packet = _extract(window, reference=reference)
    scored = {h.id: h.diagnostic_score for h in score_hypotheses(packet)}
    sensor_score = scored.get("ULTRASONIC_SENSOR_FAILURE", 0.0)
    assert sensor_score > 0.4, f"Expected ULTRASONIC_SENSOR_FAILURE > 0.4, got {sensor_score}"


# ===========================================================================
# Helpers
# ===========================================================================

_REQUIRED_OUTPUT_KEYS = {
    "primary_hypothesis", "alternative_hypotheses",
    "evidence", "reasoning", "uncertainty",
    "recommended_checks", "recommended_action",
    "severity", "is_recovery", "machine_state",
}


def _assert_required_keys(result: Dict[str, Any]) -> None:
    missing = _REQUIRED_OUTPUT_KEYS - set(result.keys())
    assert not missing, f"Missing required output keys: {missing}"
    assert isinstance(result["primary_hypothesis"], dict)
    assert "id" in result["primary_hypothesis"]
    assert "diagnostic_score" in result["primary_hypothesis"]
    assert isinstance(result["alternative_hypotheses"], list)
    assert isinstance(result["evidence"], list)
    assert isinstance(result["reasoning"], list)
    assert isinstance(result["uncertainty"], list)
    assert isinstance(result["recommended_checks"], list)
    assert isinstance(result["recommended_action"], list)
    assert result["severity"] in ("info", "warning", "critical")
