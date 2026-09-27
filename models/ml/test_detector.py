"""Unit tests for IndustrialDoctor statistical anomaly detection ML layer.

Verifies baseline reference construction, healthy telemetry validation, fault detection
for drag, jam, and sensor faults, nearest-PWM fallback, and low-sample fallback.
"""

import os
import tempfile
import pytest

from ml.mock_data_generator import generate_mock_data, write_mock_csv
from ml.reference_builder import build_reference_set, save_reference_set, load_reference_set
from ml.detector import score_reading


@pytest.fixture(scope="session")
def healthy_reference_data():
    """Generates a temporary healthy dataset and builds a baseline reference set."""
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp_file:
        tmp_csv_path = tmp_file.name

    try:
        # Generate 60 samples per bucket for robust baseline covariance estimation
        rows = generate_mock_data(samples_per_bucket=60, fault=None, seed=123)
        write_mock_csv(rows, tmp_csv_path)

        reference = build_reference_set(tmp_csv_path)
        yield reference, rows
    finally:
        if os.path.exists(tmp_csv_path):
            os.remove(tmp_csv_path)


def test_reference_builder_structure(healthy_reference_data):
    """Verifies that the reference builder computes mean vectors and covariance matrices."""
    reference, _ = healthy_reference_data

    assert "buckets" in reference
    assert "mode_pwms" in reference
    assert reference["total_samples"] > 0

    forward_bucket = reference["buckets"].get("forward:150")
    assert forward_bucket is not None
    assert forward_bucket["sample_count"] == 60
    assert len(forward_bucket["mean_vector"]) == 2  # [current_a, rpm]
    assert len(forward_bucket["covariance_matrix"]) == 2
    assert forward_bucket["use_zscore_fallback"] is False


def test_healthy_telemetry_scores_as_normal(healthy_reference_data):
    """Confirms that healthy operating readings do not trigger false positive anomalies."""
    reference, healthy_rows = healthy_reference_data

    # Sample a slice of healthy rows across different modes and PWM commands
    test_rows = healthy_rows[::15]
    for reading in test_rows:
        result = score_reading(reading, reference, threshold=3.5)
        assert result["is_anomaly"] is False, (
            f"False positive on healthy reading: {reading}, score={result['anomaly_score']}, "
            f"reasons={result['reasons']}"
        )
        assert result["anomaly_score"] <= 3.5
        assert "features" in result
        assert "current_a" in result["features"]
        assert "rpm" in result["features"]


def test_drag_fault_detection(healthy_reference_data):
    """Verifies that mechanical drag (elevated current, reduced RPM) is flagged with sensible reasons."""
    reference, _ = healthy_reference_data

    drag_rows = generate_mock_data(samples_per_bucket=10, fault="drag", seed=77)
    forward_drag = [r for r in drag_rows if r["mode"] == "forward" and r["pwm_command"] == 150]

    for reading in forward_drag:
        result = score_reading(reading, reference, threshold=3.0)
        assert result["is_anomaly"] is True, f"Failed to detect drag fault on reading: {reading}"
        assert result["anomaly_score"] > 3.0

        # Verify diagnostic reasons
        reasons_text = " ".join(result["reasons"]).lower()
        assert "current" in reasons_text or "rpm" in reasons_text or "deviates" in reasons_text
        assert "above" in reasons_text or "below" in reasons_text or "deviates" in reasons_text


def test_jam_fault_detection(healthy_reference_data):
    """Verifies that mechanical jam (stall current spike, zero RPM) is flagged as anomalous."""
    reference, _ = healthy_reference_data

    jam_rows = generate_mock_data(samples_per_bucket=10, fault="jam", seed=88)
    forward_jam = [r for r in jam_rows if r["mode"] == "forward" and r["pwm_command"] == 200]

    for reading in forward_jam:
        result = score_reading(reading, reference, threshold=3.0)
        assert result["is_anomaly"] is True, f"Failed to detect jam fault on reading: {reading}"
        assert result["anomaly_score"] > 3.0

        reasons_text = " ".join(result["reasons"]).lower()
        assert "current" in reasons_text
        assert "above" in reasons_text


def test_sensor_fault_detection(healthy_reference_data):
    """Verifies that implausible ultrasonic distance readings are detected with explicit reasons."""
    reference, _ = healthy_reference_data

    sensor_fault_rows = generate_mock_data(samples_per_bucket=5, fault="sensor_fault", seed=99)
    for reading in sensor_fault_rows:
        result = score_reading(reading, reference, threshold=3.0)
        assert result["is_anomaly"] is True, f"Failed to detect sensor fault on reading: {reading}"

        reasons_text = " ".join(result["reasons"]).lower()
        assert "ultrasonic" in reasons_text or "distance" in reasons_text


def test_nearest_pwm_fallback(healthy_reference_data):
    """Verifies that an unmodeled PWM command falls back to the nearest baseline and notes this."""
    reference, _ = healthy_reference_data

    # Commanded PWM 140 is not in standard baseline [100, 150, 200], nearest is 150
    reading = {
        "timestamp": 1700000000.0,
        "car_id": "car-01",
        "distance_cm": 80.0,
        "current_a": 1.26,
        "rpm": 208.0,
        "pwm_command": 140,
        "mode": "forward",
    }

    result = score_reading(reading, reference, threshold=3.0)
    assert result["matched_pwm"] == 150
    assert any("nearest baseline at PWM 150" in reason for reason in result["reasons"])


def test_low_sample_zscore_fallback():
    """Verifies that buckets with < 20 samples use z-score fallback and note this in output reasons."""
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp_file:
        tmp_csv_path = tmp_file.name

    try:
        # Generate only 10 samples per bucket (< 20 threshold)
        sparse_rows = generate_mock_data(samples_per_bucket=10, seed=42)
        write_mock_csv(sparse_rows, tmp_csv_path)

        sparse_reference = build_reference_set(tmp_csv_path)
        bucket = sparse_reference["buckets"]["forward:100"]
        assert bucket["use_zscore_fallback"] is True
        assert bucket["sample_count"] == 10

        test_reading = {
            "timestamp": 1700000000.0,
            "car_id": "car-01",
            "distance_cm": 85.0,
            "current_a": 0.85,
            "rpm": 125.0,
            "pwm_command": 100,
            "mode": "forward",
        }

        result = score_reading(test_reading, sparse_reference, threshold=3.0)
        assert any("fewer than 20 samples" in reason for reason in result["reasons"])
        assert any("z-score fallback" in reason for reason in result["reasons"])
    finally:
        if os.path.exists(tmp_csv_path):
            os.remove(tmp_csv_path)


def test_save_and_load_reference_roundtrip(healthy_reference_data):
    """Confirms that reference baselines serialize and deserialize identically with pickle."""
    reference, _ = healthy_reference_data

    with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False) as tmp_file:
        tmp_pkl_path = tmp_file.name

    try:
        save_reference_set(reference, tmp_pkl_path)
        loaded = load_reference_set(tmp_pkl_path)

        assert loaded["total_samples"] == reference["total_samples"]
        assert set(loaded["buckets"].keys()) == set(reference["buckets"].keys())
        assert loaded["mode_pwms"] == reference["mode_pwms"]
    finally:
        if os.path.exists(tmp_pkl_path):
            os.remove(tmp_pkl_path)
