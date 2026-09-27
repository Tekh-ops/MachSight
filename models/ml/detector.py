"""Statistical anomaly detector for IndustrialDoctor RC car telemetry.

Evaluates incoming telemetry readings against conditioned (mode, pwm_command) baseline
distributions using Mahalanobis distance over (current_a, rpm). Also performs sensor
plausibility checks and falls back to nearest-PWM or z-score evaluations when appropriate.
"""

import math
from typing import Dict, Any, List

import numpy as np
from scipy.spatial.distance import mahalanobis

# Physical plausibility limits for typical HC-SR04 ultrasonic sensors (2cm to 400cm)
MIN_VALID_DISTANCE_CM = 2.0
MAX_VALID_DISTANCE_CM = 400.0


def _find_nearest_pwm_bucket(
    mode: str,
    pwm: int,
    reference: Dict[str, Any]
) -> Dict[str, Any]:
    """Finds the closest reference bucket for a given operating mode and PWM command.

    Args:
        mode: The commanded operating mode (e.g., 'forward', 'turning_left').
        pwm: The commanded integer PWM level (0 - 255).
        reference: Reference set dictionary containing 'buckets' and 'mode_pwms'.

    Returns:
        The matched reference bucket dictionary.

    Raises:
        ValueError: If no buckets exist for the given operating mode.
    """
    mode_pwms = reference.get("mode_pwms", {})
    available_pwms = mode_pwms.get(mode)

    if not available_pwms:
        # If the requested mode is not in reference at all, find any closest bucket in reference
        all_keys = list(reference.get("buckets", {}).keys())
        if not all_keys:
            raise ValueError("Reference set contains no valid baseline buckets.")
        first_bucket = reference["buckets"][all_keys[0]]
        return first_bucket

    # Find the nearest PWM among available PWM levels for this mode
    nearest_pwm = min(available_pwms, key=lambda p: abs(p - pwm))
    bucket_key = f"{mode}:{nearest_pwm}"
    return reference["buckets"][bucket_key]


def score_reading(
    reading: Dict[str, Any],
    reference: Dict[str, Any],
    threshold: float = 3.0
) -> Dict[str, Any]:
    """Scores a telemetry reading against the conditioned reference distribution.

    Conditioned on (mode, pwm_command), evaluates Mahalanobis distance across
    (current_a, rpm). If the bucket has fewer than 20 samples or a singular covariance,
    falls back to per-feature z-score scoring. If the commanded PWM is not an exact match,
    matches against the nearest available PWM command for that mode. Also verifies sensor
    plausibility for ultrasonic distance.

    Args:
        reading: Dictionary matching TelemetryReading schema.
        reference: Statistical baseline reference dictionary built via build_reference_set.
        threshold: Anomaly score cutoff above which is_anomaly is marked True (default: 3.0).

    Returns:
        Dictionary adhering to DetectorOutput schema:
            - is_anomaly (bool): True if distance or anomaly score > threshold or sensor invalid.
            - anomaly_score (float): Computed Mahalanobis distance or combined z-score.
            - mode (str): Operational mode of the reading.
            - pwm_command (int): Commanded PWM of the input reading.
            - matched_pwm (int): Commanded PWM of the reference baseline used.
            - reasons (list[str]): Human-readable diagnostic reasons and fallback notes.
            - features (dict): Per-feature value, baseline mean, baseline std, z-score, and pct_diff.
    """
    mode = str(reading.get("mode", "idle")).strip()
    pwm_command = int(round(float(reading.get("pwm_command", 0))))
    current_val = float(reading.get("current_a", 0.0))
    rpm_val = float(reading.get("rpm", 0.0))
    distance_cm = float(reading.get("distance_cm", 0.0))

    reasons: List[str] = []
    bucket_key = f"{mode}:{pwm_command}"
    buckets = reference.get("buckets", {})

    # 1. Resolve Reference Bucket (Exact or Nearest Fallback)
    if bucket_key in buckets:
        bucket = buckets[bucket_key]
        matched_pwm = pwm_command
    else:
        bucket = _find_nearest_pwm_bucket(mode, pwm_command, reference)
        matched_pwm = bucket["pwm_command"]
        reasons.append(
            f"No exact baseline for mode '{mode}' at PWM {pwm_command}; "
            f"used nearest baseline at PWM {matched_pwm}."
        )

    # 2. Extract baseline statistics
    mean_vec = np.asarray(bucket["mean_vector"], dtype=np.float64)
    inv_cov = np.asarray(bucket["inv_covariance_matrix"], dtype=np.float64)
    current_mean = float(bucket["current_mean"])
    current_std = float(bucket["current_std"])
    rpm_mean = float(bucket["rpm_mean"])
    rpm_std = float(bucket["rpm_std"])
    use_zscore = bool(bucket.get("use_zscore_fallback", False))
    sample_count = int(bucket.get("sample_count", 0))

    # 3. Compute per-feature differences and z-scores
    diff_current = current_val - current_mean
    diff_rpm = rpm_val - rpm_mean

    # Guard against zero standard deviation
    eps_std = 1e-4
    z_current = diff_current / (current_std if current_std > eps_std else eps_std)
    z_rpm = diff_rpm / (rpm_std if rpm_std > eps_std else eps_std)

    pct_current = (diff_current / current_mean * 100.0) if abs(current_mean) > 1e-3 else 0.0
    pct_rpm = (diff_rpm / rpm_mean * 100.0) if abs(rpm_mean) > 1e-3 else 0.0

    # 4. Calculate Anomaly Distance Metric
    obs_vec = np.array([current_val, rpm_val], dtype=np.float64)

    if use_zscore:
        # Fallback to combined Euclidean z-score
        reasons.append(
            f"Baseline bucket ({mode}, PWM {matched_pwm}) has fewer than 20 samples "
            f"({sample_count}); used per-feature z-score fallback instead of Mahalanobis distance."
        )
        anomaly_score = float(math.sqrt(z_current ** 2 + z_rpm ** 2))
    else:
        try:
            # Mahalanobis distance: sqrt((x - u)^T * Sigma^-1 * (x - u))
            anomaly_score = float(mahalanobis(obs_vec, mean_vec, inv_cov))
        except Exception:
            # Fallback if numerical issues arise
            anomaly_score = float(math.sqrt(z_current ** 2 + z_rpm ** 2))
            reasons.append("Numerical instability in covariance matrix; used z-score fallback.")

    is_anomaly = anomaly_score > threshold

    # 5. Check Ultrasonic Sensor Plausibility
    sensor_fault_detected = False
    if math.isnan(distance_cm) or math.isinf(distance_cm):
        sensor_fault_detected = True
        is_anomaly = True
        reasons.append(f"Ultrasonic sensor reading is invalid: {distance_cm}")
    elif distance_cm < MIN_VALID_DISTANCE_CM or distance_cm > MAX_VALID_DISTANCE_CM:
        sensor_fault_detected = True
        is_anomaly = True
        reasons.append(
            f"Ultrasonic distance reading ({distance_cm:.1f} cm) is outside plausible physical range "
            f"[{MIN_VALID_DISTANCE_CM}, {MAX_VALID_DISTANCE_CM}] cm."
        )

    # 6. Generate human-readable diagnostic reasons for electrical/mechanical anomalies
    if anomaly_score > threshold:
        # Analyze current deviations
        if abs(pct_current) >= 15.0 or abs(z_current) >= 2.0:
            direction = "above" if diff_current > 0 else "below"
            reasons.append(
                f"Motor current ({current_val:.2f}A) is {abs(pct_current):.1f}% {direction} "
                f"baseline mean ({current_mean:.2f}A) for mode '{mode}' (z-score: {z_current:+.2f})."
            )

        # Analyze RPM deviations
        if abs(pct_rpm) >= 15.0 or abs(z_rpm) >= 2.0:
            direction = "above" if diff_rpm > 0 else "below"
            reasons.append(
                f"Wheel RPM ({rpm_val:.1f}) is {abs(pct_rpm):.1f}% {direction} "
                f"baseline mean ({rpm_mean:.1f}) for mode '{mode}' (z-score: {z_rpm:+.2f})."
            )

        # If Mahalanobis triggered due to joint correlation without single-variable trigger
        if not reasons or (len(reasons) == 1 and ("nearest baseline" in reasons[0] or "fallback" in reasons[0])):
            reasons.append(
                f"Multivariate (current_a, rpm) distribution deviates from healthy baseline "
                f"(anomaly score: {anomaly_score:.2f} > threshold {threshold:.2f})."
            )

    # Assemble structured output matching DetectorOutput schema
    output: Dict[str, Any] = {
        "is_anomaly": is_anomaly,
        "anomaly_score": round(anomaly_score, 4),
        "mode": mode,
        "pwm_command": pwm_command,
        "matched_pwm": matched_pwm,
        "reasons": reasons,
        "features": {
            "current_a": {
                "value": current_val,
                "baseline_mean": round(current_mean, 4),
                "baseline_std": round(current_std, 4),
                "z_score": round(z_current, 2),
                "pct_diff": round(pct_current, 1),
            },
            "rpm": {
                "value": rpm_val,
                "baseline_mean": round(rpm_mean, 4),
                "baseline_std": round(rpm_std, 4),
                "z_score": round(z_rpm, 2),
                "pct_diff": round(pct_rpm, 1),
            },
        },
    }

    return output
