"""Hypothesis Scorer for MachSight diagnostic reasoning.

Loads the engineering hypothesis catalog (hypothesis_catalog.yaml) and scores
each candidate hypothesis against the observed evidence patterns from the
Diagnostic Evidence Packet. Returns a ranked list of scored hypotheses.

Scoring design:
    - Each hypothesis has supporting patterns (positive weight) and contradicting patterns (negative weight).
    - Active signal patterns from the evidence packet are matched to pattern IDs.
    - The raw score is the sum of matched weights (supporting) minus matched contradictions.
    - Score is clipped to [0.0, 1.0] and labeled as 'diagnostic_score' (not probability).

This is deterministic — NO model is involved in scoring.
The model's job is to synthesize and explain scores, not produce them from scratch.

Future RAG context providers can inject additional pattern weights without
changing this scoring function.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .temporal_evidence import DiagnosticEvidencePacket, EvidenceItem

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Load catalog
# ---------------------------------------------------------------------------

_CATALOG_PATH = Path(__file__).resolve().parent / "hypothesis_catalog.yaml"
_LOADED_CATALOG: Optional[Dict[str, Any]] = None


def _load_catalog() -> Dict[str, Any]:
    global _LOADED_CATALOG
    if _LOADED_CATALOG is None:
        with open(_CATALOG_PATH, "r") as fh:
            _LOADED_CATALOG = yaml.safe_load(fh)
    return _LOADED_CATALOG


def get_catalog_hypotheses() -> List[Dict[str, Any]]:
    """Return the raw list of hypothesis definitions from the YAML catalog."""
    catalog = _load_catalog()
    return catalog.get("hypotheses", [])


# ---------------------------------------------------------------------------
# Active pattern detection from evidence packet
# ---------------------------------------------------------------------------

def _detect_active_patterns(packet: DiagnosticEvidencePacket) -> Dict[str, bool]:
    """Derive a set of active pattern IDs from the evidence packet.

    Pattern IDs map directly to those used in hypothesis_catalog.yaml.
    All detections are deterministic from sensor math — no model needed.
    """
    c = packet.current
    r = packet.rpm
    mc = packet.motor_command
    us = packet.ultrasonic
    trends = packet.trends

    current_now = c.get("current_a", 0.0)
    baseline_current = c.get("baseline_a", current_now)
    current_pct = c.get("increase_pct") or 0.0

    rpm_now = r.get("current_rpm", 0.0)
    baseline_rpm = r.get("baseline_rpm", rpm_now)
    rpm_pct = r.get("change_pct") or 0.0

    pwm = mc.get("pwm", 0)
    pwm_sustained = mc.get("sustained", False)

    stall_threshold = max(20.0, baseline_rpm * 0.22)

    dist_cm = us.get("distance_cm", 100.0) if us else 100.0

    vel = packet.velocity
    vel_pct = (vel.get("change_pct") or 0.0) if vel else 0.0

    from .temporal_evidence import Persistence, Trend
    is_persistent = packet.persistence in (Persistence.PERSISTENT,)

    return {
        # Motor command
        "high_motor_command": pwm_sustained and pwm > 30,
        "motor_command_zero": pwm == 0,
        "motor_command_active": pwm > 30,

        # Current
        "elevated_current": current_pct > 40,
        "normal_current": abs(current_pct) < 25,
        "current_spike_with_normal_rpm": current_pct > 80 and abs(rpm_pct) < 25,
        "current_spike_with_normal_velocity": current_pct > 80 and abs(vel_pct) < 25,

        # RPM
        "low_rpm": rpm_now <= stall_threshold and pwm > 30,
        "rpm_collapsed": rpm_now <= stall_threshold,
        "normal_rpm": abs(rpm_pct) < 20,
        "reduced_rpm": rpm_pct < -20 and rpm_pct > -70,
        "high_rpm": rpm_pct > 10,
        "rpm_zero_with_normal_current": rpm_now <= stall_threshold and abs(current_pct) < 25 and pwm > 30,
        "rpm_zero_with_normal_velocity": rpm_now <= stall_threshold and abs(vel_pct) < 25 and pwm > 30,
        "rpm_also_reduced": rpm_pct < -20,

        # Velocity
        "falling_velocity": vel_pct < -30 if vel else False,
        "low_velocity": vel_pct < -50 if vel else False,
        "velocity_also_zero": abs(vel_pct) > 80 if vel else False,
        "velocity_also_reduced": vel_pct < -20 if vel else False,
        "normal_velocity": abs(vel_pct) < 20 if vel else True,

        # Ratio
        "elevated_current_rpm_ratio": (
            (current_pct - rpm_pct) > 50 if rpm_pct < -0.1 else current_pct > 50
        ),

        # Persistence
        "persistent_condition": is_persistent,

        # Ultrasonic
        "distance_out_of_range": us is not None and (dist_cm < 2.0 or dist_cm > 400.0),
        "distance_frozen": "distance_cm" in (us or {}) and trends.get("distance") == "stable",
        "distance_large_jump": False,  # Would require window delta check
        "distance_normal": us is None or (2.0 <= dist_cm <= 400.0),

        # Voltage
        "low_voltage": False,     # Voltage sensor not always present
        "normal_voltage": True,

        # Other
        "reduced_rpm_at_normal_command": rpm_pct < -20 and pwm_sustained,
        "anomalous_behavior": packet.operating_state.value in ("FAULTED", "FAULT_SUSPECTED"),
    }


# ---------------------------------------------------------------------------
# Scored hypothesis
# ---------------------------------------------------------------------------

@dataclass
class ScoredHypothesis:
    """A candidate fault hypothesis with evidence-based diagnostic score."""

    id: str
    label: str
    description: str
    affected_subsystem: str
    severity: str
    diagnostic_score: float           # Heuristic ranking score [0, 1]
    supporting_evidence_ids: List[str]   # Evidence item IDs that support this
    contradicting_evidence_ids: List[str]
    matched_supporting_patterns: List[str]
    matched_contradicting_patterns: List[str]
    recommended_checks: List[Dict[str, Any]]
    possible_actions: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "affected_subsystem": self.affected_subsystem,
            "severity": self.severity,
            "diagnostic_score": round(self.diagnostic_score, 3),
            "supporting_evidence_ids": self.supporting_evidence_ids,
            "contradicting_evidence_ids": self.contradicting_evidence_ids,
            "matched_supporting_patterns": self.matched_supporting_patterns,
            "matched_contradicting_patterns": self.matched_contradicting_patterns,
            "recommended_checks": self.recommended_checks,
            "possible_actions": self.possible_actions,
        }


# ---------------------------------------------------------------------------
# Core scoring function
# ---------------------------------------------------------------------------

def score_hypotheses(
    packet: DiagnosticEvidencePacket,
    max_candidates: int = 4,
) -> List[ScoredHypothesis]:
    """Score all catalog hypotheses against the evidence packet.

    Args:
        packet: Diagnostic Evidence Packet from temporal_evidence.extract_diagnostic_evidence().
        max_candidates: Maximum number of scored hypotheses to return.

    Returns:
        List of ScoredHypothesis sorted by diagnostic_score descending,
        capped at max_candidates. Always includes at least the top-1 result.
    """
    active_patterns = _detect_active_patterns(packet)
    evidence_items = packet.evidence_items

    # Build evidence_id lookup: hypothesis_id → list of evidence item IDs that support/contradict
    evidence_supports: Dict[str, List[str]] = {}
    evidence_contradicts: Dict[str, List[str]] = {}
    for item in evidence_items:
        for hyp_id in item.supports:
            evidence_supports.setdefault(hyp_id, []).append(item.id)
        for hyp_id in item.contradicts:
            evidence_contradicts.setdefault(hyp_id, []).append(item.id)

    hypotheses_defs = get_catalog_hypotheses()
    scored: List[ScoredHypothesis] = []

    for hyp in hypotheses_defs:
        hyp_id = hyp["id"]
        raw_score = 0.0
        matched_supporting: List[str] = []
        matched_contradicting: List[str] = []

        # Supporting patterns
        for sp in hyp.get("supporting_patterns", []):
            pid = sp["id"]
            weight = float(sp.get("weight", 0.0))
            if active_patterns.get(pid, False):
                raw_score += weight
                matched_supporting.append(sp["description"])

        # Contradicting patterns
        for cp in hyp.get("contradicting_patterns", []):
            pid = cp["id"]
            weight = float(cp.get("weight", 0.0))  # already negative in catalog
            if active_patterns.get(pid, False):
                raw_score += weight  # weight is already negative
                matched_contradicting.append(cp["description"])

        # Apply evidence item confidence boost (mild — evidence already captured above)
        ev_support_ids = evidence_supports.get(hyp_id, [])
        ev_contradict_ids = evidence_contradicts.get(hyp_id, [])

        # Clip to [0, 1]
        diagnostic_score = max(0.0, min(1.0, raw_score))

        scored.append(ScoredHypothesis(
            id=hyp_id,
            label=hyp.get("label", hyp_id),
            description=hyp.get("description", "").strip(),
            affected_subsystem=hyp.get("affected_subsystem", "unknown"),
            severity=hyp.get("severity", "MEDIUM"),
            diagnostic_score=diagnostic_score,
            supporting_evidence_ids=ev_support_ids,
            contradicting_evidence_ids=ev_contradict_ids,
            matched_supporting_patterns=matched_supporting,
            matched_contradicting_patterns=matched_contradicting,
            recommended_checks=hyp.get("recommended_checks", []),
            possible_actions=hyp.get("possible_actions", []),
        ))

    # Sort by score descending
    scored.sort(key=lambda h: h.diagnostic_score, reverse=True)

    return scored[:max_candidates]
