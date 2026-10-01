"""Feature extraction and window preprocessing for IndustrialDoctor telemetry.

Calculates conditioned feature deviations against baseline operational buckets
and computes rolling window metrics including statistical moments and trend slopes.
"""

import math
from typing import Dict, Any, List, Optional
import numpy as np

from .detector import score_reading

MIN_VALID_DISTANCE_CM = 1.0
MAX_VALID_DISTANCE_CM = 450.0


def process_reading(
    raw: Dict[str, Any],
    reference: Dict[str, Any],
    window: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Processes a single telemetry reading against the conditioned reference baseline.

    Args:
        raw: Raw telemetry dictionary with car_id, distance_cm, current_a, rpm, pwm_command, mode.
        reference: Reference set dictionary built via build_reference_set.
        window: Optional list of recent raw telemetry dictionaries for temporal checks.

    Returns:
        Dictionary containing:
            - current_rpm_ratio (float): Ratio of current to wheel RPM.
            - current_zscore (float): Z-score of current_a against baseline bucket.
            - rpm_zscore (float): Z-score of rpm against baseline bucket.
            - mahalanobis_distance (float): Statistical anomaly distance.
            - distance_plausible (bool): True if within [2.0, 400.0] cm, valid number, and not frozen.
            - bucket_used (str): Baseline operational bucket identifier (e.g., 'forward:200').
            - contextual feature baselines and raw values for classification and reasoning.
    """
    mode = str(raw.get("mode", "idle")).strip()
    pwm_command = int(round(float(raw.get("pwm_command", 0))))
    current_val = float(raw.get("current_a", 0.0))
    rpm_val = float(raw.get("rpm", 0.0))
    distance_cm = float(raw.get("distance_cm", 0.0))

    # Compute current/rpm ratio, guarding against division by zero
    current_rpm_ratio = current_val / max(rpm_val, 1.0)

    # Score reading using existing baseline detector
    detector_output = score_reading(raw, reference)

    current_feature = detector_output["features"]["current_a"]
    rpm_feature = detector_output["features"]["rpm"]

    current_zscore = float(current_feature["z_score"]) if current_feature["z_score"] is not None else 0.0
    rpm_zscore = float(rpm_feature["z_score"]) if rpm_feature["z_score"] is not None else 0.0
    mahalanobis_dist = float(detector_output["anomaly_score"])

    baseline_c_mean = float(current_feature["baseline_mean"])
    baseline_rpm_mean = float(rpm_feature["baseline_mean"])
    baseline_c_std = float(current_feature["baseline_std"])
    baseline_rpm_std = float(rpm_feature["baseline_std"])

    matched_pwm = detector_output["matched_pwm"]
    matched_mode = detector_output["mode"]
    bucket_used = f"{matched_mode}:{matched_pwm}"

    baseline_ratio = baseline_c_mean / max(baseline_rpm_mean, 1.0)

    # Evaluate distance plausibility: within physical bounds and not NaN / infinite
    distance_plausible = True
    if math.isnan(distance_cm) or math.isinf(distance_cm):
        distance_plausible = False
    elif distance_cm < MIN_VALID_DISTANCE_CM or distance_cm > MAX_VALID_DISTANCE_CM:
        distance_plausible = False

    # Check if distance is frozen while vehicle is active (only for in-range obstacles < 390 cm)
    if distance_plausible and window and len(window) >= 3:
        is_moving = mode != "idle" and (rpm_val > 10.0 or pwm_command > 0)
        if is_moving and distance_cm < 390.0:
            dist_samples = [float(r.get("distance_cm", 0.0)) for r in window] + [distance_cm]
            # If standard deviation is essentially zero across consecutive readings while moving
            if float(np.std(dist_samples)) < 1e-4:
                distance_plausible = False

    return {
        "current_rpm_ratio": round(current_rpm_ratio, 6),
        "current_zscore": round(current_zscore, 4),
        "rpm_zscore": round(rpm_zscore, 4),
        "mahalanobis_distance": round(mahalanobis_dist, 4),
        "distance_plausible": distance_plausible,
        "bucket_used": bucket_used,
        # Contextual feature data for classification and LLM prompt construction
        "car_id": raw.get("car_id", "car-01"),
        "timestamp": raw.get("timestamp"),
        "mode": mode,
        "pwm_command": pwm_command,
        "matched_pwm": matched_pwm,
        "current_a": current_val,
        "rpm": rpm_val,
        "distance_cm": distance_cm,
        "baseline_current_mean": round(baseline_c_mean, 4),
        "baseline_rpm_mean": round(baseline_rpm_mean, 4),
        "baseline_current_std": round(baseline_c_std, 4),
        "baseline_rpm_std": round(baseline_rpm_std, 4),
        "baseline_current_rpm_ratio": round(baseline_ratio, 6),
        "is_anomaly": detector_output["is_anomaly"],
        "reasons": detector_output["reasons"],
    }


def process_window(
    readings: List[Dict[str, Any]],
    reference: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Calculates summary statistics, linear trend slopes, and anomaly percentage across a telemetry window.

    Args:
        readings: List of telemetry dictionaries (raw or processed).
        reference: Optional reference baseline dictionary to evaluate anomaly status if not already scored.

    Returns:
        Dictionary with:
            - count (int): Total readings in window.
            - current_mean (float): Mean motor current.
            - current_std (float): Sample standard deviation of motor current.
            - current_trend_slope (float): Linear trend slope of current across the window.
            - rpm_mean (float): Mean wheel RPM.
            - rpm_std (float): Sample standard deviation of wheel RPM.
            - rpm_trend_slope (float): Linear trend slope of RPM across the window.
            - distance_mean (float): Mean distance measurement.
            - distance_std (float): Sample standard deviation of distance.
            - pct_anomalous (float): Percentage of window readings marked anomalous (0.0 to 100.0).
            - distance_frozen (bool): True if distance variance is near-zero across >= 3 samples.
            - max_distance_jump (float): Maximum absolute step change between adjacent distance readings.
    """
    if not readings:
        return {
            "count": 0,
            "current_mean": 0.0,
            "current_std": 0.0,
            "current_trend_slope": 0.0,
            "rpm_mean": 0.0,
            "rpm_std": 0.0,
            "rpm_trend_slope": 0.0,
            "distance_mean": 0.0,
            "distance_std": 0.0,
            "pct_anomalous": 0.0,
            "distance_frozen": False,
            "max_distance_jump": 0.0,
        }

    n = len(readings)
    current_arr = np.array([float(r.get("current_a", 0.0)) for r in readings], dtype=np.float64)
    rpm_arr = np.array([float(r.get("rpm", 0.0)) for r in readings], dtype=np.float64)
    dist_arr = np.array([float(r.get("distance_cm", 0.0)) for r in readings], dtype=np.float64)

    curr_mean = float(np.mean(current_arr))
    curr_std = float(np.std(current_arr, ddof=1)) if n > 1 else 0.0
    rpm_mean = float(np.mean(rpm_arr))
    rpm_std = float(np.std(rpm_arr, ddof=1)) if n > 1 else 0.0
    dist_mean = float(np.mean(dist_arr))
    dist_std = float(np.std(dist_arr, ddof=1)) if n > 1 else 0.0

    # Trend slope helper using linear least squares: cov(x, y) / var(x)
    def _slope(arr: np.ndarray) -> float:
        if len(arr) < 2:
            return 0.0
        x = np.arange(len(arr), dtype=np.float64)
        x_centered = x - np.mean(x)
        y_centered = arr - np.mean(arr)
        denom = np.sum(x_centered ** 2)
        return float(np.sum(x_centered * y_centered) / denom) if denom > 1e-9 else 0.0

    curr_slope = _slope(current_arr)
    rpm_slope = _slope(rpm_arr)

    # Anomaly percentage calculation
    anomaly_flags: List[bool] = []
    for r in readings:
        if "is_anomaly" in r:
            anomaly_flags.append(bool(r["is_anomaly"]))
        elif reference is not None:
            score = score_reading(r, reference)
            anomaly_flags.append(bool(score["is_anomaly"]))
        elif "mahalanobis_distance" in r:
            anomaly_flags.append(float(r["mahalanobis_distance"]) > 3.0)
        else:
            anomaly_flags.append(False)

    pct_anomalous = (sum(anomaly_flags) / n) * 100.0 if n > 0 else 0.0

    # Distance jump and frozen analysis
    max_jump = float(np.max(np.abs(np.diff(dist_arr)))) if n >= 2 else 0.0
    distance_frozen = dist_std < 1e-4 and n >= 3

    return {
        "count": n,
        "current_mean": round(curr_mean, 4),
        "current_std": round(curr_std, 4),
        "current_trend_slope": round(curr_slope, 4),
        "rpm_mean": round(rpm_mean, 4),
        "rpm_std": round(rpm_std, 4),
        "rpm_trend_slope": round(rpm_slope, 4),
        "distance_mean": round(dist_mean, 4),
        "distance_std": round(dist_std, 4),
        "pct_anomalous": round(pct_anomalous, 1),
        "distance_frozen": distance_frozen,
        "max_distance_jump": round(max_jump, 2),
    }
