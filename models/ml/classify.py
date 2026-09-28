"""Rule-based fault classification layer for IndustrialDoctor RC car telemetry.

Evaluates processed feature deviations and temporal window characteristics against
known physical fault signatures: mechanical drag, obstruction jam, sensor fault,
and motor mismatch.
"""

import logging
import math
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Canonical fault signatures with documentation and indicators for the LLM reasoner
FAULT_SIGNATURES: Dict[str, Dict[str, Any]] = {
    "mechanical_drag": {
        "title": "Mechanical Drag / Drivetrain Friction",
        "description": (
            "Elevated resistance in drivetrain, wheel bearings, or axles causing higher motor "
            "current draw and reduced wheel RPM. The current/RPM ratio is 30% to 100%+ above "
            "conditioned baseline and sustained across the observation window."
        ),
        "indicators": [
            "current_rpm_ratio 30% to 100%+ above bucket baseline",
            "sustained ratio elevation across window (elevated pct_anomalous)",
            "wheel RPM remains non-zero (distinguishing from complete jam)",
        ],
    },
    "obstruction_jam": {
        "title": "Mechanical Obstruction / Drivetrain Jam",
        "description": (
            "Complete mechanical lockup or severe stall where motor draws extreme current (stall draw) "
            "while wheel RPM collapses to near-zero, occurring while the ultrasonic path ahead is clear "
            "(confirming internal jam rather than an external obstacle impact)."
        ),
        "indicators": [
            "current z-score >= 3.0 (severe overcurrent / stall draw)",
            "rpm z-score <= -2.0 (wheel lockup / near-zero RPM)",
            "distance reading indicates clear path ahead (distance_cm >= 25.0 cm)",
        ],
    },
    "sensor_fault": {
        "title": "Ultrasonic Distance Sensor Fault",
        "description": (
            "Malfunction of the ultrasonic distance sensor resulting in out-of-range physical values "
            "(< 2.0 cm or > 400.0 cm), frozen readings with zero variance while the vehicle is in motion, "
            "or implausible discontinuous jumps between consecutive samples."
        ),
        "indicators": [
            "distance reading outside physical sensor range [2.0, 400.0] cm",
            "distance reading frozen while vehicle is active / moving",
            "discontinuous distance jump (> 150 cm) in consecutive window readings",
        ],
    },
    "motor_mismatch": {
        "title": "Dual-Motor Asymmetry / Differential Mismatch",
        "description": (
            "Velocity or torque disparity between left and right drive motors. "
            "Applicable only to dual-motor differential drive configurations with per-wheel telemetry."
        ),
        "indicators": [
            "divergence between left and right wheel RPM or motor currents",
        ],
    },
}


def classify(
    processed: Dict[str, Any],
    window: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """Evaluates processed features and window statistics against fault signatures.

    Args:
        processed: Feature dictionary returned by process_reading().
        window: Optional window statistics dictionary returned by process_window().

    Returns:
        List of fault match dictionaries ranked by score descending:
            [{"fault": str, "score": float, "matched_conditions": list[str], "contradicting": list[str]}]
        Returns a single [{"fault": "healthy", ...}] match when no fault scores above 0.3.
    """
    candidates: List[Dict[str, Any]] = []

    current_z = float(processed.get("current_zscore", 0.0))
    rpm_z = float(processed.get("rpm_zscore", 0.0))
    current_rpm_ratio = float(processed.get("current_rpm_ratio", 0.0))
    baseline_ratio = float(processed.get("baseline_current_rpm_ratio", 0.0))
    dist_val = float(processed.get("distance_cm", 0.0))
    dist_plausible = bool(processed.get("distance_plausible", True))
    mode = str(processed.get("mode", "idle"))
    rpm_val = float(processed.get("rpm", 0.0))
    pwm_val = int(processed.get("pwm_command", 0))

    # -------------------------------------------------------------------------
    # 1. Fault Signature: mechanical_drag
    # -------------------------------------------------------------------------
    drag_matched: List[str] = []
    drag_contradicting: List[str] = []

    ratio_elevation_pct = (
        ((current_rpm_ratio - baseline_ratio) / baseline_ratio) * 100.0
        if baseline_ratio > 1e-6
        else 0.0
    )

    is_near_stall = (rpm_val <= 5.0 and current_z >= 3.0)

    if ratio_elevation_pct >= 30.0 and not is_near_stall:
        drag_matched.append(
            f"Current/RPM ratio ({current_rpm_ratio:.4f}) is {ratio_elevation_pct:.1f}% "
            f"above bucket baseline ({baseline_ratio:.4f})"
        )
        if window and window.get("count", 0) >= 3:
            pct_anom = float(window.get("pct_anomalous", 0.0))
            if pct_anom >= 50.0:
                drag_matched.append(
                    f"Elevated ratio sustained across temporal window ({pct_anom:.1f}% anomalous samples)"
                )
            else:
                drag_contradicting.append(
                    f"Ratio elevation is transient across window ({pct_anom:.1f}% anomalous samples)"
                )

        # Baseline score scaling between 30% and 100%+ elevation
        drag_score = min(0.92, 0.65 + (ratio_elevation_pct - 30.0) * 0.003)
        if window and float(window.get("pct_anomalous", 0.0)) >= 50.0:
            drag_score = min(0.98, drag_score + 0.06)
    else:
        drag_score = 0.0
        if is_near_stall:
            drag_contradicting.append(
                "Wheel RPM is near zero with extreme stall current, indicative of obstruction jam rather than drag friction"
            )
        else:
            drag_contradicting.append(
                f"Current/RPM ratio ({ratio_elevation_pct:.1f}% vs baseline) does not meet 30% elevation threshold"
            )

    candidates.append({
        "fault": "mechanical_drag",
        "score": round(drag_score, 2),
        "matched_conditions": drag_matched,
        "contradicting": drag_contradicting,
    })

    # -------------------------------------------------------------------------
    # 2. Fault Signature: obstruction_jam
    # -------------------------------------------------------------------------
    jam_matched: List[str] = []
    jam_contradicting: List[str] = []

    c_match = current_z >= 3.0
    rpm_match = rpm_z <= -2.0
    # Clear path: distance >= 25 cm and plausible (not collision with wall)
    path_clear = dist_plausible and dist_val >= 25.0

    if c_match:
        jam_matched.append(
            f"Motor current z-score ({current_z:+.2f}) >= 3.0 indicates severe overcurrent / stall draw"
        )
    else:
        jam_contradicting.append(
            f"Motor current z-score ({current_z:+.2f}) is below stall threshold (< 3.0)"
        )

    if rpm_match:
        jam_matched.append(
            f"Wheel RPM z-score ({rpm_z:+.2f}) <= -2.0 indicates wheel lockup / near-zero rotation"
        )
    else:
        jam_contradicting.append(
            f"Wheel RPM z-score ({rpm_z:+.2f}) is above stall threshold (> -2.0)"
        )

    if path_clear:
        jam_matched.append(
            f"Ultrasonic distance ({dist_val:.1f} cm) indicates clear path ahead, ruling out obstacle collision"
        )
    else:
        jam_contradicting.append(
            f"Ultrasonic distance ({dist_val:.1f} cm) indicates obstacle contact or invalid range"
        )

    if c_match and rpm_match and path_clear:
        jam_score = 0.95
        if window and float(window.get("rpm_mean", 100.0)) < 10.0:
            jam_score = 0.98
    elif c_match and rpm_match:
        jam_score = 0.70  # stall current + zero rpm, but distance ambiguous
    elif c_match or rpm_match:
        jam_score = 0.20
    else:
        jam_score = 0.0

    candidates.append({
        "fault": "obstruction_jam",
        "score": round(jam_score, 2),
        "matched_conditions": jam_matched,
        "contradicting": jam_contradicting,
    })

    # -------------------------------------------------------------------------
    # 3. Fault Signature: sensor_fault
    # -------------------------------------------------------------------------
    sensor_matched: List[str] = []
    sensor_contradicting: List[str] = []

    out_of_bounds = (
        math.isnan(dist_val)
        or math.isinf(dist_val)
        or dist_val < 2.0
        or dist_val > 400.0
    )

    is_moving = mode != "idle" and (rpm_val > 10.0 or pwm_val > 50)
    is_frozen = bool(
        is_moving
        and window
        and (
            window.get("distance_frozen", False)
            or (float(window.get("distance_std", 1.0)) < 1e-4 and int(window.get("count", 0)) >= 3)
        )
    )

    has_jump = bool(window and float(window.get("max_distance_jump", 0.0)) > 150.0)

    if out_of_bounds:
        sensor_matched.append(
            f"Ultrasonic distance reading ({dist_val:.1f} cm) is outside valid physical range [2.0, 400.0] cm"
        )
    if is_frozen:
        sensor_matched.append(
            f"Ultrasonic distance is frozen at {dist_val:.1f} cm with zero variance while vehicle is moving (mode: {mode}, PWM: {pwm_val})"
        )
    if has_jump:
        sensor_matched.append(
            f"Implausible distance step jump ({window['max_distance_jump']:.1f} cm) detected across consecutive readings"
        )

    if out_of_bounds:
        sensor_score = 0.96
    elif is_frozen:
        sensor_score = 0.90
    elif has_jump:
        sensor_score = 0.85
    else:
        sensor_score = 0.0
        sensor_contradicting.append(
            f"Ultrasonic distance ({dist_val:.1f} cm) is within normal physical operating range with natural variance"
        )

    candidates.append({
        "fault": "sensor_fault",
        "score": round(sensor_score, 2),
        "matched_conditions": sensor_matched,
        "contradicting": sensor_contradicting,
    })

    # -------------------------------------------------------------------------
    # 4. Fault Signature: motor_mismatch
    # -------------------------------------------------------------------------
    # Check for per-wheel RPM/current fields
    per_wheel_fields = ["rpm_left", "rpm_right", "left_rpm", "right_rpm", "current_left", "current_right"]
    has_per_wheel = any(field in processed for field in per_wheel_fields)

    if has_per_wheel:
        left_rpm = float(processed.get("rpm_left", processed.get("left_rpm", 0.0)))
        right_rpm = float(processed.get("rpm_right", processed.get("right_rpm", 0.0)))
        diff_rpm = abs(left_rpm - right_rpm)
        mean_rpm = max((left_rpm + right_rpm) / 2.0, 1.0)
        mismatch_pct = (diff_rpm / mean_rpm) * 100.0

        if mismatch_pct >= 25.0:
            candidates.append({
                "fault": "motor_mismatch",
                "score": round(min(0.95, 0.50 + mismatch_pct * 0.01), 2),
                "matched_conditions": [
                    f"Left/right motor speed disparity of {mismatch_pct:.1f}% (left: {left_rpm:.1f} RPM, right: {right_rpm:.1f} RPM)"
                ],
                "contradicting": [],
            })
        else:
            candidates.append({
                "fault": "motor_mismatch",
                "score": 0.0,
                "matched_conditions": [],
                "contradicting": [f"Dual motor speeds closely aligned ({mismatch_pct:.1f}% deviation)"],
            })
    else:
        logger.info(
            "Skipping motor_mismatch fault: per-wheel RPM fields not present in single-motor RC telemetry."
        )

    # -------------------------------------------------------------------------
    # Rank candidates and apply healthy fallback threshold (0.3)
    # -------------------------------------------------------------------------
    ranked_candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)
    valid_matches = [c for c in ranked_candidates if c["score"] > 0.3]

    if not valid_matches:
        top_score = ranked_candidates[0]["score"] if ranked_candidates else 0.0
        healthy_score = round(max(0.70, 1.0 - top_score), 2)
        return [{
            "fault": "healthy",
            "score": healthy_score,
            "matched_conditions": [
                "All telemetry features and ratios align with conditioned baseline distributions"
            ],
            "contradicting": [],
        }]

    return valid_matches
