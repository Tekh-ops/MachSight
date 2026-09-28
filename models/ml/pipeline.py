"""Pipeline facade and evidence builder for IndustrialDoctor ML layer.

Provides a unified analyze() entrypoint combining statistical scoring, feature extraction,
temporal window analysis, and rule-based classification, plus build_evidence() to construct
concise, high-signal evidence payloads for the LLM reasoning agent.
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


def build_evidence(
    raw: Dict[str, Any],
    processed: Dict[str, Any],
    matches: List[Dict[str, Any]],
    window: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Constructs a compact, high-density evidence dictionary for LLM reasoner consumption.

    Keeps the total JSON payload small (under ~1500 characters) to fit comfortably within
    constrained local LLM context budgets (e.g. Ollama 7B running on 8GB RAM).

    Args:
        raw: Original raw telemetry reading.
        processed: Feature dictionary from process_reading().
        matches: Ranked fault matches from classify().
        window: Optional window statistics dictionary from process_window().

    Returns:
        Structured evidence dictionary with sensor comparisons, z-scores, ratios,
        top fault matches, and window trend statistics.
    """
    evidence: Dict[str, Any] = {
        "car_id": raw.get("car_id", "car-01"),
        "mode": processed.get("mode", raw.get("mode", "idle")),
        "pwm": int(processed.get("pwm_command", raw.get("pwm_command", 0))),
        "bucket": str(processed.get("bucket_used", "")),
        "telemetry": {
            "current_a": round(float(raw.get("current_a", 0.0)), 2),
            "current_baseline": round(float(processed.get("baseline_current_mean", 0.0)), 2),
            "current_z": round(float(processed.get("current_zscore", 0.0)), 2),
            "rpm": round(float(raw.get("rpm", 0.0)), 1),
            "rpm_baseline": round(float(processed.get("baseline_rpm_mean", 0.0)), 1),
            "rpm_z": round(float(processed.get("rpm_zscore", 0.0)), 2),
            "ratio": round(float(processed.get("current_rpm_ratio", 0.0)), 4),
            "ratio_baseline": round(float(processed.get("baseline_current_rpm_ratio", 0.0)), 4),
            "distance_cm": round(float(raw.get("distance_cm", 0.0)), 1),
            "distance_plausible": bool(processed.get("distance_plausible", True)),
        },
        "anomaly": {
            "is_anomaly": bool(processed.get("is_anomaly", False)),
            "score": round(float(processed.get("mahalanobis_distance", 0.0)), 2),
            "reasons": processed.get("reasons", [])[:2],  # up to 2 key diagnostic notes
        },
        "top_matches": [
            {
                "fault": m["fault"],
                "score": round(float(m["score"]), 2),
                "matched": m.get("matched_conditions", [])[:3],
            }
            for m in matches[:2]  # top 2 matches
        ],
    }

    if window and int(window.get("count", 0)) > 0:
        evidence["window_stats"] = {
            "samples": int(window.get("count", 0)),
            "current_mean": round(float(window.get("current_mean", 0.0)), 2),
            "rpm_mean": round(float(window.get("rpm_mean", 0.0)), 1),
            "pct_anomalous": round(float(window.get("pct_anomalous", 0.0)), 1),
            "current_slope": round(float(window.get("current_trend_slope", 0.0)), 3),
            "rpm_slope": round(float(window.get("rpm_trend_slope", 0.0)), 3),
        }

    return evidence
