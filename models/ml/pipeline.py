"""Pipeline facade and evidence builder for IndustrialDoctor ML layer.

Provides a unified analyze() entrypoint combining statistical scoring, feature extraction,
temporal window analysis, and rule-based classification, plus build_evidence() to construct
a structured, machine-oriented evidence payload for the LLM reasoning agent.

Evidence contract (Phase 1):
  - machine: identity block (machine_id, asset_type)
  - operating_context: mode, pwm
  - observations: raw sensor values keyed by signal name
  - derived_features: computed ratios and z-scores
  - baselines: per-signal mean/std from the conditioned reference bucket
  - anomaly: is_anomaly flag, score, human-readable reasons
  - fault_hypotheses: ranked rule-based fault candidates
  - temporal_evidence: rolling window statistics (when available)
  - suspected_component: structured component/location hint (or null)

Backward-compat legacy keys (car_id, mode, pwm, bucket, telemetry, top_matches,
anomaly_score, reasons) are retained so existing tests and the frontend continue
to work without change.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional

from .detector import score_reading
from .reference_builder import load_reference_set
from .features import process_reading, process_window
from .classify import classify

# Module-level cached reference set
_CACHED_REFERENCE: Optional[Dict[str, Any]] = None


def get_default_reference() -> Dict[str, Any]:
    """Loads and caches the default reference baseline dictionary from reference.pkl."""
    global _CACHED_REFERENCE
    if _CACHED_REFERENCE is None:
        ref_path = Path(__file__).resolve().parent / "reference.pkl"
        if not ref_path.exists():
            ref_path = Path("models/ml/reference.pkl")
        _CACHED_REFERENCE = load_reference_set(str(ref_path))
    return _CACHED_REFERENCE


def analyze(
    raw: Dict[str, Any],
    recent_window: Optional[List[Dict[str, Any]]] = None,
    reference: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Analyzes a telemetry reading with rolling window context.

    Facade orchestrating feature extraction, rolling window statistics,
    and rule-based classification against baseline operational distributions.

    Args:
        raw: Single telemetry reading dictionary (TelemetryReading schema).
        recent_window: Optional list of recent telemetry reading dicts.
        reference: Optional reference baseline dict (defaults to models/ml/reference.pkl).

    Returns:
        Dictionary containing:
            - processed (dict): Output from process_reading().
            - matches (list[dict]): Ranked candidate fault matches from classify().
            - is_anomaly (bool): Ground-truth anomaly flag from score_reading().
    """
    if reference is None:
        reference = get_default_reference()

    # 1. Process instantaneous reading against conditioned baseline bucket
    processed = process_reading(raw, reference, window=recent_window)

    # 2. Compute rolling window summary metrics if window provided
    window_stats = process_window(recent_window, reference) if recent_window else None

    # 3. Classify potential fault modes using rule signatures
    matches = classify(processed, window_stats)

    # 4. is_anomaly is directly sourced from score_reading() (via processed["is_anomaly"])
    is_anomaly = bool(processed.get("is_anomaly", False))

    return {
        "processed": processed,
        "matches": matches,
        "is_anomaly": is_anomaly,
    }


# ---------------------------------------------------------------------------
# Component / location mapping for the RC-car testbed
# ---------------------------------------------------------------------------
# Maps fault_id → suspected component metadata when evidence clearly supports it.
# Returns None when the fault type does not imply a specific physical component.
_FAULT_COMPONENT_MAP: Dict[str, Optional[Dict[str, str]]] = {
    "obstruction_jam": {
        "component_id": "drivetrain_assembly",
        "display_name": "Drivetrain assembly",
        "system": "drive_train",
    },
    "mechanical_drag": {
        "component_id": "wheel_bearing_axle",
        "display_name": "Wheel bearing / axle",
        "system": "drive_train",
    },
    "sensor_fault": {
        "component_id": "ultrasonic_sensor",
        "display_name": "Ultrasonic distance sensor (HC-SR04)",
        "system": "sensor_array",
    },
    "motor_mismatch": {
        "component_id": "dual_motor_differential",
        "display_name": "Dual-motor differential",
        "system": "drive_train",
    },
    "healthy": None,
}

# Score threshold below which we decline to assert a specific component
_COMPONENT_ASSERT_THRESHOLD = 0.70


def _infer_suspected_component(
    top_fault: str,
    top_score: float
) -> Optional[Dict[str, str]]:
    """Return suspected component metadata if evidence is strong enough, else None.

    Only populates the field when the deterministic rule-based evidence clearly
    supports a specific component.  Does NOT fabricate a component guess.
    """
    if top_score < _COMPONENT_ASSERT_THRESHOLD:
        return None
    return _FAULT_COMPONENT_MAP.get(top_fault)


def build_evidence(
    raw: Dict[str, Any],
    processed: Dict[str, Any],
    matches: List[Dict[str, Any]],
    window: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Constructs a structured, machine-oriented evidence dictionary for LLM reasoning.

    Produces a Phase 1 evidence contract that clearly separates:
      raw observations | derived features | baselines | anomaly result |
      fault hypotheses | temporal/window evidence | operating context |
      suspected component/location metadata

    The total JSON payload is kept under ~2 KB to fit local LLM context budgets.

    All numeric values are sourced from deterministic backend code.
    The LLM MUST NOT generate or override any of these values.

    Args:
        raw: Original raw telemetry reading.
        processed: Feature dictionary from process_reading().
        matches: Ranked fault matches from classify().
        window: Optional window statistics dictionary from process_window().

    Returns:
        Structured evidence dictionary conforming to the Phase 1 evidence contract.
    """
    # --- Machine identity ---
    machine_id = raw.get("machine_id") or raw.get("car_id", "unknown")
    asset_type = raw.get("asset_type", "rc_vehicle")

    # --- Operating context ---
    mode = processed.get("mode", raw.get("mode", "idle"))
    pwm = int(processed.get("pwm_command", raw.get("pwm_command", 0)))
    bucket = str(processed.get("bucket_used", ""))

    # --- Raw observations ---
    observations: Dict[str, Any] = {}
    for signal in ("current_a", "rpm", "distance_cm", "voltage_v",
                   "temperature_c", "vibration_rms", "pressure_bar"):
        val = raw.get(signal)
        if val is not None:
            observations[signal] = round(float(val), 4)

    # --- Derived features ---
    derived_features: Dict[str, Any] = {
        "current_rpm_ratio": round(float(processed.get("current_rpm_ratio", 0.0)), 6),
    }
    if "distance_plausible" in processed:
        derived_features["distance_plausible"] = bool(processed["distance_plausible"])

    # --- Baselines (from conditioned reference bucket) ---
    baselines: Dict[str, Any] = {}
    if processed.get("baseline_current_mean") is not None:
        baselines["current_a"] = {
            "mean": round(float(processed["baseline_current_mean"]), 4),
            "std": round(float(processed.get("baseline_current_std", 0.0)), 4),
            "z_score": round(float(processed.get("current_zscore", 0.0)), 4),
        }
    if processed.get("baseline_rpm_mean") is not None:
        baselines["rpm"] = {
            "mean": round(float(processed["baseline_rpm_mean"]), 4),
            "std": round(float(processed.get("baseline_rpm_std", 0.0)), 4),
            "z_score": round(float(processed.get("rpm_zscore", 0.0)), 4),
        }
    if processed.get("baseline_current_rpm_ratio") is not None:
        baselines["current_rpm_ratio"] = {
            "mean": round(float(processed["baseline_current_rpm_ratio"]), 6),
        }

    # --- Anomaly result ---
    anomaly_block: Dict[str, Any] = {
        "is_anomaly": bool(processed.get("is_anomaly", False)),
        "score": round(float(processed.get("mahalanobis_distance", 0.0)), 4),
        "reasons": [r[:25] for r in processed.get("reasons", [])[:1]],
    }

    # --- Fault hypotheses ---
    fault_hypotheses = [
        {
            "fault": m["fault"],
            "score": round(float(m["score"]), 4),
            "matched_conditions": [c[:25] for c in m.get("matched_conditions", [])[:1]],
            "contradicting_conditions": [c[:25] for c in m.get("contradicting", [])[:1]],
        }
        for m in matches[:2]
    ]

    # --- Temporal / window evidence ---
    temporal_evidence: Dict[str, Any] = {}
    if window and int(window.get("count", 0)) > 0:
        temporal_evidence = {
            "samples": int(window.get("count", 0)),
            "current_mean": round(float(window.get("current_mean", 0.0)), 4),
            "rpm_mean": round(float(window.get("rpm_mean", 0.0)), 4),
            "pct_anomalous": round(float(window.get("pct_anomalous", 0.0)), 1),
            "current_slope": round(float(window.get("current_trend_slope", 0.0)), 4),
            "rpm_slope": round(float(window.get("rpm_trend_slope", 0.0)), 4),
        }

    # --- Suspected component ---
    top_fault = fault_hypotheses[0]["fault"] if fault_hypotheses else "unknown"
    top_score = float(fault_hypotheses[0]["score"]) if fault_hypotheses else 0.0
    suspected_component = _infer_suspected_component(top_fault, top_score)

    # -----------------------------------------------------------------------
    # Assemble the structured Phase 1 evidence object
    # -----------------------------------------------------------------------
    evidence: Dict[str, Any] = {
        # --- New machine-oriented structure ---
        "machine": {
            "machine_id": machine_id,
            "asset_type": asset_type,
        },
        "operating_context": {
            "mode": mode,
            "pwm": pwm,
            "bucket": bucket,
        },
        "observations": observations,
        "derived_features": derived_features,
        "baselines": baselines,
        "anomaly": anomaly_block,
        "fault_hypotheses": fault_hypotheses,
        "temporal_evidence": None,
        "suspected_component": suspected_component,

        # --- Legacy flat keys (backward compat for existing tests / frontend) ---
        "car_id": machine_id,
        "mode": mode,
        "pwm": pwm,
        "bucket": bucket,
        "telemetry": {
            "current_a": observations.get("current_a", 0.0),
            "current_baseline": baselines.get("current_a", {}).get("mean", 0.0),
            "current_z": baselines.get("current_a", {}).get("z_score", 0.0),
            "rpm": observations.get("rpm", 0.0),
            "rpm_baseline": baselines.get("rpm", {}).get("mean", 0.0),
            "rpm_z": baselines.get("rpm", {}).get("z_score", 0.0),
            "ratio": derived_features.get("current_rpm_ratio", 0.0),
            "ratio_baseline": baselines.get("current_rpm_ratio", {}).get("mean", 0.0),
            "distance_cm": observations.get("distance_cm", 0.0),
            "distance_plausible": derived_features.get("distance_plausible", True),
        },
        "top_matches": [
            {
                "fault": h["fault"],
                "score": h["score"],
                "matched": h["matched_conditions"],
            }
            for h in fault_hypotheses[:2]
        ],
        "reasons": anomaly_block["reasons"],
        "anomaly_score": anomaly_block["score"],
    }

    if temporal_evidence:
        evidence["window_stats"] = temporal_evidence

    return evidence
