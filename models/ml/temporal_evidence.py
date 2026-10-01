"""Temporal Evidence Engine for MachSight intelligent diagnostic reasoning.

Converts a rolling telemetry window into a compact Diagnostic Evidence Packet:
  - Absolute sensor observations
  - Healthy baselines (pre-fault or long-run mean)
  - Delta and percentage change from baseline
  - Signal trends (increasing / decreasing / stable / oscillating)
  - Persistence classification (transient / persistent / recovering)
  - Temporal relationship patterns (e.g., high_pwm + low_rpm)
  - Structured evidence items (E001…E009) with ID, type, source, confidence

Design principle:
  The LLM reasons over THESE evidence items — not raw sensor arrays.
  Every field here is produced deterministically from sensor math.
  The model must NEVER invent observations or modify these values.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

import numpy as np


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class Trend(str, Enum):
    INCREASING = "increasing"
    DECREASING = "decreasing"
    STABLE = "stable"
    OSCILLATING = "oscillating"
    UNKNOWN = "unknown"


class Persistence(str, Enum):
    TRANSIENT = "transient"      # < 3 s
    PERSISTENT = "persistent"    # >= 3 s sustained
    INTERMITTENT = "intermittent"
    RECOVERING = "recovering"
    UNKNOWN = "unknown"


class MachineOperatingState(str, Enum):
    IDLE = "IDLE"
    ACCELERATING = "ACCELERATING"
    CRUISING = "CRUISING"
    DECELERATING = "DECELERATING"
    STOPPED = "STOPPED"
    FAULT_SUSPECTED = "FAULT_SUSPECTED"
    FAULTED = "FAULTED"
    RECOVERING = "RECOVERING"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Evidence item schema
# ---------------------------------------------------------------------------

@dataclass
class EvidenceItem:
    """A single structured observation derived deterministically from telemetry."""

    id: str                              # E001, E002, …
    type: str                            # "observed_behavior" | "derived_relationship" | "temporal_pattern"
    description: str                     # Human-readable observation
    source: str                          # Sensor / derived feature name
    value: Optional[float]               # Current observed value
    baseline: Optional[float]            # Expected healthy baseline
    change_pct: Optional[float]          # Percentage change from baseline
    confidence: float                    # Evidence confidence (0–1), deterministic
    supports: List[str]                  # Hypothesis IDs this evidence supports
    contradicts: List[str]               # Hypothesis IDs this evidence contradicts

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Diagnostic Evidence Packet
# ---------------------------------------------------------------------------

@dataclass
class DiagnosticEvidencePacket:
    """Compact, structured summary of machine state and evidence for LLM reasoning.

    This is the ONLY thing sent to the LLM — never raw sensor arrays.
    All values are rounded and bounded to fit within a small context window.
    """

    machine_id: str
    operating_state: MachineOperatingState
    time_window_seconds: float

    # Signal summaries
    current: Dict[str, Any]        # baseline_a, current_a, increase_pct
    rpm: Dict[str, Any]            # baseline_rpm, current_rpm, change_pct
    velocity: Optional[Dict[str, Any]]  # baseline_mps, current_mps, change_pct
    motor_command: Dict[str, Any]  # pwm, sustained (bool)
    ultrasonic: Optional[Dict[str, Any]]  # distance_cm, trend

    # Trend and persistence
    trends: Dict[str, str]         # {signal: trend_name}
    persistence: Persistence

    # Temporal relationship flags
    temporal_relationships: List[str]

    # Structured evidence items
    evidence_items: List[EvidenceItem]

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["operating_state"] = self.operating_state.value
        d["persistence"] = self.persistence.value
        d["evidence_items"] = [e.to_dict() for e in self.evidence_items]
        return d

    def to_llm_payload(self) -> Dict[str, Any]:
        """Return a compact payload safe to send to the LLM (no redundant raw arrays)."""
        return {
            "machine_id": self.machine_id,
            "operating_state": self.operating_state.value,
            "time_window_seconds": self.time_window_seconds,
            "current": self.current,
            "rpm": self.rpm,
            "velocity": self.velocity,
            "motor_command": self.motor_command,
            "ultrasonic": self.ultrasonic,
            "trends": self.trends,
            "persistence": self.persistence.value,
            "temporal_relationships": self.temporal_relationships,
            "evidence": [
                {
                    "id": e.id,
                    "description": e.description,
                    "source": e.source,
                    "value": e.value,
                    "baseline": e.baseline,
                    "change_pct": e.change_pct,
                    "confidence": e.confidence,
                    "supports": e.supports,
                    "contradicts": e.contradicts,
                }
                for e in self.evidence_items
            ],
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _safe_pct_change(current: float, baseline: float) -> Optional[float]:
    if baseline and abs(baseline) > 1e-6:
        return round(((current - baseline) / abs(baseline)) * 100.0, 1)
    return None


def _classify_trend(values: Sequence[float], threshold_slope: float = 0.01) -> Trend:
    """Classify trend of a numeric series using linear regression slope."""
    if len(values) < 3:
        return Trend.UNKNOWN
    arr = np.array(values, dtype=float)
    if np.all(np.isnan(arr)):
        return Trend.UNKNOWN
    x = np.arange(len(arr), dtype=float)
    x_c = x - x.mean()
    y_c = arr - arr.mean()
    denom = float(np.sum(x_c ** 2))
    slope = float(np.sum(x_c * y_c) / denom) if denom > 1e-9 else 0.0

    normalized_range = (arr.max() - arr.min()) / max(abs(arr.mean()), 1e-6)
    if normalized_range < 0.05:
        return Trend.STABLE

    # Oscillation check: count sign changes in the differences
    diffs = np.diff(arr)
    sign_changes = int(np.sum(np.diff(np.sign(diffs)) != 0))
    if sign_changes >= max(2, len(diffs) // 2):
        return Trend.OSCILLATING
    if slope > threshold_slope:
        return Trend.INCREASING
    if slope < -threshold_slope:
        return Trend.DECREASING
    return Trend.STABLE


def _classify_persistence(
    window_seconds: float,
    anomaly_fraction: float,
) -> Persistence:
    """Classify how persistent an abnormal condition is."""
    if window_seconds < 1.0:
        return Persistence.UNKNOWN
    if anomaly_fraction >= 0.80:
        if window_seconds >= 3.0:
            return Persistence.PERSISTENT
        return Persistence.TRANSIENT
    if anomaly_fraction >= 0.50:
        return Persistence.INTERMITTENT
    if anomaly_fraction < 0.20 and window_seconds > 3.0:
        return Persistence.RECOVERING
    return Persistence.UNKNOWN


def _estimate_operating_state(
    pwm: int,
    rpm: float,
    current_a: float,
    baseline_rpm: float,
    baseline_current: float,
    is_anomaly: bool,
    persistence: Persistence,
) -> MachineOperatingState:
    """Deterministic operating state estimation from sensor context.

    CRITICAL: PWM=0 and RPM=0 → STOPPED/IDLE, NOT a fault.
    Faults require motor command active AND abnormal response.
    """
    stall_rpm = max(20.0, baseline_rpm * 0.22)
    current_high = current_a > baseline_current * 1.5
    rpm_collapsed = rpm <= stall_rpm
    motor_active = pwm > 30

    if not motor_active and rpm < 5.0:
        return MachineOperatingState.STOPPED

    if not motor_active and rpm < baseline_rpm * 0.1:
        return MachineOperatingState.IDLE

    if motor_active and is_anomaly and persistence == Persistence.PERSISTENT:
        if current_high and rpm_collapsed:
            return MachineOperatingState.FAULTED
        return MachineOperatingState.FAULT_SUSPECTED

    if motor_active and is_anomaly and persistence in (Persistence.INTERMITTENT, Persistence.TRANSIENT):
        return MachineOperatingState.FAULT_SUSPECTED

    if motor_active and rpm > baseline_rpm * 1.1:
        return MachineOperatingState.ACCELERATING
    if motor_active and rpm > baseline_rpm * 0.85:
        return MachineOperatingState.CRUISING
    if not motor_active and rpm > baseline_rpm * 0.3:
        return MachineOperatingState.DECELERATING

    return MachineOperatingState.UNKNOWN


# ---------------------------------------------------------------------------
# Main evidence extraction function
# ---------------------------------------------------------------------------

def extract_diagnostic_evidence(
    machine_id: str,
    window: List[Dict[str, Any]],
    processed_latest: Dict[str, Any],
    matches: List[Dict[str, Any]],
    healthy_baseline: Optional[Dict[str, Any]] = None,
    window_seconds: float = 10.0,
) -> DiagnosticEvidencePacket:
    """Build a Diagnostic Evidence Packet from a rolling telemetry window.

    Args:
        machine_id: Machine identifier.
        window: List of recent raw telemetry dicts (newest last).
        processed_latest: Feature dict from process_reading() for the latest packet.
        matches: Ranked fault matches from classify().
        healthy_baseline: Optional explicit healthy baseline override.
                          If None, uses processed_latest baselines.
        window_seconds: Approximate time span of the window.

    Returns:
        DiagnosticEvidencePacket ready for hypothesis scoring and LLM reasoning.
    """
    if not window:
        window = [{}]

    # -------------------------------------------------------------------------
    # Signal extraction from window
    # -------------------------------------------------------------------------
    currents = [float(r.get("current_a", 0.0)) for r in window if r.get("current_a") is not None]
    rpms = [float(r.get("rpm", 0.0)) for r in window if r.get("rpm") is not None]
    pwms = [int(r.get("pwm_command", 0)) for r in window]
    distances = [float(r.get("distance_cm", 0.0)) for r in window if r.get("distance_cm") is not None]

    current_now = currents[-1] if currents else float(processed_latest.get("current_a", 0.0))
    rpm_now = rpms[-1] if rpms else float(processed_latest.get("rpm", 0.0))
    pwm_now = pwms[-1] if pwms else int(processed_latest.get("pwm_command", 0))
    dist_now = distances[-1] if distances else float(processed_latest.get("distance_cm", 0.0))

    # -------------------------------------------------------------------------
    # Baselines (from reference bucket, may be overridden)
    # -------------------------------------------------------------------------
    if healthy_baseline:
        baseline_current = float(healthy_baseline.get("current_a", 1.6))
        baseline_rpm = float(healthy_baseline.get("rpm", 225.0))
    else:
        baseline_current = float(processed_latest.get("baseline_current_mean", current_now))
        baseline_rpm = float(processed_latest.get("baseline_rpm_mean", rpm_now))

    # Guard: if baseline is zero (no reference), use first window sample
    if baseline_current < 1e-6 and len(currents) > 3:
        baseline_current = float(np.mean(currents[:max(3, len(currents) // 3)]))
    if baseline_rpm < 1e-6 and len(rpms) > 3:
        baseline_rpm = float(np.mean(rpms[:max(3, len(rpms) // 3)]))

    # -------------------------------------------------------------------------
    # Trends
    # -------------------------------------------------------------------------
    trend_current = _classify_trend(currents)
    trend_rpm = _classify_trend(rpms)
    trend_dist = _classify_trend(distances) if len(distances) >= 3 else Trend.UNKNOWN

    # -------------------------------------------------------------------------
    # Anomaly fraction (for persistence)
    # -------------------------------------------------------------------------
    anomaly_flags = [bool(r.get("is_anomaly", False)) for r in window]
    anomaly_fraction = sum(anomaly_flags) / len(anomaly_flags) if anomaly_flags else 0.0

    # -------------------------------------------------------------------------
    # Persistence
    # -------------------------------------------------------------------------
    persistence = _classify_persistence(window_seconds, anomaly_fraction)

    # -------------------------------------------------------------------------
    # Operating state
    # -------------------------------------------------------------------------
    is_anomaly_now = bool(processed_latest.get("is_anomaly", False))
    operating_state = _estimate_operating_state(
        pwm=pwm_now,
        rpm=rpm_now,
        current_a=current_now,
        baseline_rpm=baseline_rpm,
        baseline_current=baseline_current,
        is_anomaly=is_anomaly_now,
        persistence=persistence,
    )

    # -------------------------------------------------------------------------
    # Signal summaries
    # -------------------------------------------------------------------------
    current_change_pct = _safe_pct_change(current_now, baseline_current)
    rpm_change_pct = _safe_pct_change(rpm_now, baseline_rpm)

    current_summary = {
        "baseline_a": round(baseline_current, 3),
        "current_a": round(current_now, 3),
        "increase_pct": current_change_pct,
        "trend": trend_current.value,
    }

    rpm_summary = {
        "baseline_rpm": round(baseline_rpm, 1),
        "current_rpm": round(rpm_now, 1),
        "change_pct": rpm_change_pct,
        "trend": trend_rpm.value,
    }

    pwm_sustained = pwm_now > 30 and (
        len([p for p in pwms if p > 30]) >= max(1, len(pwms) * 0.7)
    )
    motor_command_summary = {
        "pwm": pwm_now,
        "sustained": pwm_sustained,
    }

    dist_summary = None
    if distances:
        dist_summary = {
            "distance_cm": round(dist_now, 1),
            "trend": trend_dist.value,
        }

    velocity_summary = None  # velocity not in current telemetry schema directly

    # -------------------------------------------------------------------------
    # Temporal relationships
    # -------------------------------------------------------------------------
    stall_threshold = max(20.0, baseline_rpm * 0.22)
    relationships: List[str] = []

    if pwm_sustained:
        relationships.append("motor_command_remained_high")

    if current_change_pct is not None and current_change_pct > 30:
        relationships.append("current_increased")

    if rpm_change_pct is not None and rpm_change_pct < -30:
        relationships.append("rpm_decreased")

    if rpm_now <= stall_threshold and pwm_now > 30:
        relationships.append("rpm_collapsed_while_motor_commanded")

    if current_change_pct is not None and current_change_pct > 30 and rpm_now <= stall_threshold:
        relationships.append("current_high_and_rpm_collapsed")

    if trend_current == Trend.INCREASING and trend_rpm == Trend.DECREASING:
        relationships.append("current_rising_while_rpm_falling")

    if persistence in (Persistence.PERSISTENT, Persistence.INTERMITTENT):
        relationships.append("condition_is_persistent")

    if operating_state in (MachineOperatingState.FAULTED, MachineOperatingState.FAULT_SUSPECTED):
        if trend_current == Trend.DECREASING and trend_rpm == Trend.INCREASING:
            relationships.append("signals_recovering_toward_baseline")

    # -------------------------------------------------------------------------
    # Build structured evidence items
    # -------------------------------------------------------------------------
    evidence_items: List[EvidenceItem] = []
    eid = 0

    def next_eid() -> str:
        nonlocal eid
        eid += 1
        return f"E{eid:03d}"

    # E001: Motor command sustained
    if pwm_sustained:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description=f"Motor command sustained above operating threshold (PWM={pwm_now})",
            source="pwm_command",
            value=float(pwm_now),
            baseline=None,
            change_pct=None,
            confidence=0.99,
            supports=["DRIVETRAIN_OBSTRUCTION", "MOTOR_OVERLOAD", "MOTOR_DRAG"],
            contradicts=[],
        ))
    elif pwm_now == 0:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description="Motor command is zero — expected IDLE or STOPPED state",
            source="pwm_command",
            value=0.0,
            baseline=None,
            change_pct=None,
            confidence=0.99,
            supports=[],
            contradicts=["DRIVETRAIN_OBSTRUCTION", "MOTOR_OVERLOAD", "MOTOR_DRAG"],
        ))

    # E002: Current increase
    if current_change_pct is not None and current_change_pct > 30:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description=(
                f"Motor current increased {current_change_pct:.1f}% above healthy baseline "
                f"({current_now:.2f}A vs {baseline_current:.2f}A baseline)"
            ),
            source="current_a",
            value=round(current_now, 3),
            baseline=round(baseline_current, 3),
            change_pct=current_change_pct,
            confidence=min(0.99, 0.80 + abs(current_change_pct) / 500.0),
            supports=["DRIVETRAIN_OBSTRUCTION", "MOTOR_OVERLOAD"],
            contradicts=["RPM_SENSOR_FAILURE", "CURRENT_SENSOR_FAILURE" if current_change_pct > 200 else ""],
        ))

    # E003: RPM collapse
    if rpm_change_pct is not None and rpm_change_pct < -50:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description=(
                f"Wheel RPM decreased {abs(rpm_change_pct):.1f}% from healthy baseline "
                f"({rpm_now:.1f} RPM vs {baseline_rpm:.1f} RPM baseline)"
            ),
            source="rpm",
            value=round(rpm_now, 1),
            baseline=round(baseline_rpm, 1),
            change_pct=rpm_change_pct,
            confidence=min(0.99, 0.80 + abs(rpm_change_pct) / 200.0),
            supports=["DRIVETRAIN_OBSTRUCTION", "MOTOR_OVERLOAD"],
            contradicts=["WHEEL_SLIP"],
        ))
    elif rpm_change_pct is not None and rpm_change_pct < -20:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description=(
                f"Wheel RPM reduced {abs(rpm_change_pct):.1f}% from baseline "
                f"({rpm_now:.1f} RPM vs {baseline_rpm:.1f} RPM)"
            ),
            source="rpm",
            value=round(rpm_now, 1),
            baseline=round(baseline_rpm, 1),
            change_pct=rpm_change_pct,
            confidence=0.80,
            supports=["MOTOR_DRAG", "MOTOR_OVERLOAD"],
            contradicts=[],
        ))

    # E004: RPM zero with active motor (stall)
    if rpm_now <= stall_threshold and pwm_now > 30:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="derived_relationship",
            description=(
                f"Wheel RPM ({rpm_now:.1f} RPM) at or below stall threshold "
                f"while motor is commanded (PWM={pwm_now}) — indicates physical wheel lockup"
            ),
            source="rpm:pwm_command",
            value=round(rpm_now, 1),
            baseline=round(stall_threshold, 1),
            change_pct=None,
            confidence=0.97,
            supports=["DRIVETRAIN_OBSTRUCTION"],
            contradicts=["RPM_SENSOR_FAILURE"],  # will be overridden if current is normal
        ))

    # E005: RPM zero with normal current (sensor fault candidate)
    if rpm_now <= stall_threshold and current_change_pct is not None and abs(current_change_pct) < 30 and pwm_now > 30:
        # RPM collapsed but current is still normal — sensor failure more likely
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="derived_relationship",
            description=(
                f"Wheel RPM ({rpm_now:.1f} RPM) near zero but current ({current_now:.2f}A) "
                f"remains near healthy baseline — possible RPM sensor failure"
            ),
            source="rpm:current_a",
            value=round(rpm_now, 1),
            baseline=round(baseline_rpm, 1),
            change_pct=rpm_change_pct,
            confidence=0.82,
            supports=["RPM_SENSOR_FAILURE"],
            contradicts=["DRIVETRAIN_OBSTRUCTION"],
        ))

    # E006: Persistence
    if persistence == Persistence.PERSISTENT:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="temporal_pattern",
            description=(
                f"Abnormal condition persisted across the observation window "
                f"({window_seconds:.1f}s window, {anomaly_fraction*100:.0f}% anomalous samples)"
            ),
            source="window_temporal",
            value=window_seconds,
            baseline=None,
            change_pct=None,
            confidence=min(0.99, 0.70 + anomaly_fraction * 0.30),
            supports=["DRIVETRAIN_OBSTRUCTION", "MOTOR_OVERLOAD"],
            contradicts=[],
        ))
    elif persistence == Persistence.TRANSIENT:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="temporal_pattern",
            description="Abnormal condition appears transient — not sustained across the window",
            source="window_temporal",
            value=window_seconds,
            baseline=None,
            change_pct=None,
            confidence=0.70,
            supports=[],
            contradicts=["DRIVETRAIN_OBSTRUCTION"],
        ))

    # E007: Elevated current/RPM ratio
    ratio_now = current_now / max(rpm_now, 1.0)
    baseline_ratio = baseline_current / max(baseline_rpm, 1.0)
    ratio_change = _safe_pct_change(ratio_now, baseline_ratio)
    if ratio_change is not None and ratio_change > 50:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="derived_relationship",
            description=(
                f"Current/RPM ratio elevated {ratio_change:.1f}% above healthy baseline "
                f"(ratio={ratio_now:.5f} vs baseline={baseline_ratio:.5f})"
            ),
            source="current_rpm_ratio",
            value=round(ratio_now, 5),
            baseline=round(baseline_ratio, 5),
            change_pct=ratio_change,
            confidence=0.90,
            supports=["DRIVETRAIN_OBSTRUCTION", "MOTOR_DRAG"],
            contradicts=[],
        ))

    # E008: Ultrasonic sensor normal (rules out obstacle collision)
    if dist_now >= 25.0 and (not math.isnan(dist_now)) and dist_now <= 400.0 and pwm_now > 30 and rpm_now < stall_threshold:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description=(
                f"Ultrasonic distance ({dist_now:.1f} cm) indicates clear path ahead "
                f"— external obstacle collision is not the primary cause"
            ),
            source="distance_cm",
            value=round(dist_now, 1),
            baseline=None,
            change_pct=None,
            confidence=0.90,
            supports=["DRIVETRAIN_OBSTRUCTION"],  # confirms internal jam not external obstacle
            contradicts=[],
        ))

    # E009: Distance sensor fault
    dist_out_of_range = dist_now < 2.0 or dist_now > 400.0 or math.isnan(dist_now)
    if dist_out_of_range and distances:
        evidence_items.append(EvidenceItem(
            id=next_eid(),
            type="observed_behavior",
            description=(
                f"Ultrasonic distance reading ({dist_now:.1f} cm) is outside "
                f"the valid physical range [2, 400] cm"
            ),
            source="distance_cm",
            value=round(dist_now, 1) if not math.isnan(dist_now) else None,
            baseline=None,
            change_pct=None,
            confidence=0.96,
            supports=["ULTRASONIC_SENSOR_FAILURE"],
            contradicts=[],
        ))

    # -------------------------------------------------------------------------
    # Assemble packet
    # -------------------------------------------------------------------------
    return DiagnosticEvidencePacket(
        machine_id=machine_id,
        operating_state=operating_state,
        time_window_seconds=round(window_seconds, 1),
        current=current_summary,
        rpm=rpm_summary,
        velocity=velocity_summary,
        motor_command=motor_command_summary,
        ultrasonic=dist_summary,
        trends={
            "current": trend_current.value,
            "rpm": trend_rpm.value,
            "distance": trend_dist.value if distances else "unknown",
        },
        persistence=persistence,
        temporal_relationships=relationships,
        evidence_items=evidence_items,
    )
