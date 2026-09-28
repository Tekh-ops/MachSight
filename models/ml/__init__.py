"""IndustrialDoctor Machine Learning & Statistical Anomaly Detection Layer.

Training-free statistical anomaly detector conditioning motor current and wheel RPM
against operating mode and commanded PWM buckets using Mahalanobis distance.
"""

from .schemas import TelemetryReading, DetectorOutput, FeatureBaselineComparison, BucketReference
from .reference_builder import build_reference_set, save_reference_set, load_reference_set
from .detector import score_reading
from .features import process_reading, process_window
from .classify import classify, FAULT_SIGNATURES
from .pipeline import analyze, build_evidence

__all__ = [
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
]

