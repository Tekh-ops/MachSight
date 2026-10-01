"""IndustrialDoctor Machine Learning & Statistical Anomaly Detection Layer.

Training-free statistical anomaly detector conditioning motor current and wheel RPM
against operating mode and commanded PWM buckets using Mahalanobis distance.

Phase 2 additions:
  - temporal_evidence: Diagnostic Evidence Packet extraction
  - hypothesis_scorer: Evidence-based hypothesis scoring against catalog
  - diagnostic_lifecycle: Per-machine fault lifecycle state machine
  - diagnostic_reasoner: Intelligent Qwen 3B diagnostic reasoning (v2)
"""

from .schemas import TelemetryReading, DetectorOutput, FeatureBaselineComparison, BucketReference
from .reference_builder import build_reference_set, save_reference_set, load_reference_set
from .detector import score_reading
from .features import process_reading, process_window
from .classify import classify, FAULT_SIGNATURES
from .pipeline import analyze, build_evidence
from .reasoner import reason, reason_fallback

# Phase 2 — Intelligent diagnostic reasoning
from .temporal_evidence import (
    extract_diagnostic_evidence,
    DiagnosticEvidencePacket,
    EvidenceItem,
    MachineOperatingState,
    Trend,
    Persistence,
)
from .hypothesis_scorer import score_hypotheses, ScoredHypothesis, get_catalog_hypotheses
from .diagnostic_lifecycle import (
    DiagnosticLifecycle,
    DiagnosticLifecycleState,
    DiagnosticTrigger,
    diagnostic_lifecycle_registry,
)
from .diagnostic_reasoner import reason_v2, reason_fallback_v2, build_recovery_result

__all__ = [
    # Phase 1
    "TelemetryReading",
    "DetectorOutput",
    "FeatureBaselineComparison",
    "BucketReference",
    "build_reference_set",
    "save_reference_set",
    "load_reference_set",
    "score_reading",
    "process_reading",
    "process_window",
    "classify",
    "FAULT_SIGNATURES",
    "analyze",
    "build_evidence",
    "reason",
    "reason_fallback",
    # Phase 2
    "extract_diagnostic_evidence",
    "DiagnosticEvidencePacket",
    "EvidenceItem",
    "MachineOperatingState",
    "Trend",
    "Persistence",
    "score_hypotheses",
    "ScoredHypothesis",
    "get_catalog_hypotheses",
    "DiagnosticLifecycle",
    "DiagnosticLifecycleState",
    "DiagnosticTrigger",
    "diagnostic_lifecycle_registry",
    "reason_v2",
    "reason_fallback_v2",
    "build_recovery_result",
]



