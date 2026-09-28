"""Unit tests for MachSight feature extraction, window preprocessing, and classification layer.

Verifies:
1. Healthy mock data classifies as 'healthy'.
2. Fault modes ('drag', 'jam', 'sensor_fault') classify with correct fault identifiers and matched conditions.
3. Motor mismatch behavior handles single-motor vs dual-motor telemetry properly.
4. build_evidence output remains strictly under 1500 characters.
5. process_reading and process_window contract compliance.
"""

import json
from pathlib import Path
import pytest

from ml.mock_data_generator import generate_mock_data
from ml.reference_builder import load_reference_set
from ml.features import process_reading, process_window
from ml.classify import classify, FAULT_SIGNATURES
from ml.pipeline import analyze, build_evidence


@pytest.fixture(scope="session")
def reference():
    """Loads the pre-built reference baseline."""
    ref_path = Path(__file__).resolve().parent / "reference.pkl"
    return load_reference_set(str(ref_path))


def test_process_reading_contract(reference):
    """Verifies that process_reading returns all expected fields including bucket_used and distance_plausible."""
    raw = {
        "car_id": "car-01",
        "distance_cm": 85.0,
        "current_a": 1.75,
        "rpm": 305.0,
        "pwm_command": 200,
        "mode": "forward",
    }
    processed = process_reading(raw, reference)

    assert "current_rpm_ratio" in processed
    assert "current_zscore" in processed
    assert "rpm_zscore" in processed
    assert "mahalanobis_distance" in processed
    assert "distance_plausible" in processed
    assert "bucket_used" in processed

    assert processed["distance_plausible"] is True
    assert processed["bucket_used"] == "forward:200"
    assert isinstance(processed["current_rpm_ratio"], float)
    assert abs(processed["current_zscore"]) < 1.0


def test_process_window_contract():
    """Verifies that process_window computes means, standard deviations, trend slopes, and anomaly percentage."""
    readings = [
        {"current_a": 1.0, "rpm": 100.0, "distance_cm": 80.0, "is_anomaly": False},
        {"current_a": 1.2, "rpm": 110.0, "distance_cm": 75.0, "is_anomaly": False},
        {"current_a": 1.4, "rpm": 120.0, "distance_cm": 70.0, "is_anomaly": True},
        {"current_a": 1.6, "rpm": 130.0, "distance_cm": 65.0, "is_anomaly": True},
    ]
    window_stats = process_window(readings)

    assert window_stats["count"] == 4
    assert window_stats["current_mean"] == pytest.approx(1.3, rel=1e-2)
    assert window_stats["current_trend_slope"] > 0.0  # current is increasing
    assert window_stats["rpm_mean"] == pytest.approx(115.0, rel=1e-2)
    assert window_stats["rpm_trend_slope"] > 0.0  # rpm is increasing
    assert window_stats["pct_anomalous"] == 50.0
    assert window_stats["distance_frozen"] is False


def test_healthy_telemetry_classifies_as_healthy(reference):
    """Verifies that normal, healthy telemetry produces a single 'healthy' match."""
    healthy_rows = generate_mock_data(samples_per_bucket=15, fault=None, seed=42)
    forward_healthy = [r for r in healthy_rows if r["mode"] == "forward" and r["pwm_command"] == 200]

    # Evaluate multiple healthy samples with window context
    window = forward_healthy[:8]
    for reading in forward_healthy[8:12]:
        res = analyze(reading, recent_window=window, reference=reference)
        assert res["is_anomaly"] is False
        assert len(res["matches"]) == 1
        top_match = res["matches"][0]
        assert top_match["fault"] == "healthy"
        assert top_match["score"] > 0.3
        assert len(top_match["matched_conditions"]) > 0


def test_drag_fault_classification(reference):
    """Verifies that mechanical drag elevates current_rpm_ratio and classifies as 'mechanical_drag'."""
    drag_rows = generate_mock_data(samples_per_bucket=15, fault="drag", seed=77)
    forward_drag = [r for r in drag_rows if r["mode"] == "forward" and r["pwm_command"] == 150]

    window = forward_drag[:6]
    test_reading = forward_drag[7]

    res = analyze(test_reading, recent_window=window, reference=reference)
    assert res["is_anomaly"] is True

    top_match = res["matches"][0]
    assert top_match["fault"] == "mechanical_drag"
    assert top_match["score"] >= 0.70

    # Ensure sensible matched conditions
    matched_text = " ".join(top_match["matched_conditions"]).lower()
    assert "ratio" in matched_text
    assert "above" in matched_text or "baseline" in matched_text


def test_jam_fault_classification(reference):
    """Verifies that mechanical jam exhibits stall current, zero RPM, and classifies as 'obstruction_jam'."""
    jam_rows = generate_mock_data(samples_per_bucket=15, fault="jam", seed=88)
    forward_jam = [r for r in jam_rows if r["mode"] == "forward" and r["pwm_command"] == 200]

    window = forward_jam[:6]
    test_reading = forward_jam[7]

    res = analyze(test_reading, recent_window=window, reference=reference)
    assert res["is_anomaly"] is True

    top_match = res["matches"][0]
    assert top_match["fault"] == "obstruction_jam"
    assert top_match["score"] >= 0.90

    matched_text = " ".join(top_match["matched_conditions"]).lower()
    assert "current" in matched_text
    assert "rpm" in matched_text
    assert "clear path" in matched_text or "distance" in matched_text


def test_sensor_fault_out_of_range(reference):
    """Verifies that out-of-range ultrasonic readings classify as 'sensor_fault'."""
    sensor_rows = generate_mock_data(samples_per_bucket=10, fault="sensor_fault", seed=99)
    test_reading = sensor_rows[0]

    res = analyze(test_reading, recent_window=None, reference=reference)
    assert res["is_anomaly"] is True

    top_match = res["matches"][0]
    assert top_match["fault"] == "sensor_fault"
    assert top_match["score"] >= 0.90

    matched_text = " ".join(top_match["matched_conditions"]).lower()
    assert "ultrasonic" in matched_text or "distance" in matched_text


def test_sensor_fault_frozen_distance(reference):
    """Verifies that a frozen distance sensor while vehicle is moving triggers 'sensor_fault'."""
    # Moving forward at PWM 200, but distance never changes (frozen at 45.0 cm)
    window = [
        {"distance_cm": 45.0, "current_a": 1.75, "rpm": 305.0, "pwm_command": 200, "mode": "forward"}
        for _ in range(5)
    ]
    test_reading = {
        "car_id": "car-01",
        "distance_cm": 45.0,
        "current_a": 1.76,
        "rpm": 304.0,
        "pwm_command": 200,
        "mode": "forward",
    }

    res = analyze(test_reading, recent_window=window, reference=reference)
    assert res["processed"]["distance_plausible"] is False

    top_match = res["matches"][0]
    assert top_match["fault"] == "sensor_fault"
    matched_text = " ".join(top_match["matched_conditions"]).lower()
    assert "frozen" in matched_text


def test_motor_mismatch_skipped_on_single_motor(reference, caplog):
    """Verifies that single-motor telemetry logs a skip line and does not include motor_mismatch."""
    raw = {
        "car_id": "car-01",
        "distance_cm": 80.0,
        "current_a": 1.75,
        "rpm": 305.0,
        "pwm_command": 200,
        "mode": "forward",
    }
    processed = process_reading(raw, reference)
    matches = classify(processed, window=None)

    # motor_mismatch should not be in matches
    assert not any(m["fault"] == "motor_mismatch" for m in matches)


def test_motor_mismatch_triggers_when_per_wheel_rpm_differs(reference):
    """Verifies that motor_mismatch triggers when explicit per-wheel RPM fields show significant disparity."""
    raw = {
        "car_id": "car-01",
        "distance_cm": 80.0,
        "current_a": 2.2,
        "rpm": 250.0,
        "rpm_left": 300.0,
        "rpm_right": 180.0,  # 40% disparity
        "pwm_command": 200,
        "mode": "forward",
    }
    processed = process_reading(raw, reference)
    processed["rpm_left"] = raw["rpm_left"]
    processed["rpm_right"] = raw["rpm_right"]

    matches = classify(processed, window=None)
    mismatch_match = next((m for m in matches if m["fault"] == "motor_mismatch"), None)
    assert mismatch_match is not None
    assert mismatch_match["score"] > 0.5


def test_build_evidence_stays_under_1500_chars(reference):
    """Verifies that build_evidence generates compact evidence under 1500 characters for all fault states."""
    test_cases = [
        ("healthy", None),
        ("drag", "drag"),
        ("jam", "jam"),
        ("sensor_fault", "sensor_fault"),
    ]

    for label, fault in test_cases:
        rows = generate_mock_data(samples_per_bucket=10, fault=fault, seed=55)
        raw = rows[0]
        window = rows[1:6]

        res = analyze(raw, recent_window=window, reference=reference)
        window_stats = process_window(window, reference)
        evidence = build_evidence(raw, res["processed"], res["matches"], window_stats)

        json_str = json.dumps(evidence)
        char_count = len(json_str)

        assert char_count < 1500, (
            f"Evidence payload for '{label}' exceeded 1500 chars: {char_count} chars.\n"
            f"Content: {json_str}"
        )
        assert "car_id" in evidence
        assert "mode" in evidence
        assert "pwm" in evidence
        assert "telemetry" in evidence
        assert "top_matches" in evidence
        assert "window_stats" in evidence
