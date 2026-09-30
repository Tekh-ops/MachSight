"""Schemas and data models for MachSight Industrial Dataset Foundation Layer.

Provides immutable, strongly-typed data contracts for normalized industrial datasets,
sensor metadata, operating conditions, fault states, quality reports, and dataset splits.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Union
import json


class DiagnosticTask(str, Enum):
    """Supported diagnostic task types across industrial datasets."""
    ANOMALY_DETECTION = "anomaly_detection"
    FAULT_CLASSIFICATION = "fault_classification"
    RUL_DEGRADATION = "rul_degradation"
    DIAGNOSTIC_REASONING = "diagnostic_reasoning"
    AUXILIARY = "auxiliary"
    NOT_SUITABLE = "not_suitable"


class SplitStrategy(str, Enum):
    """Data splitting strategies to prevent leakage."""
    BY_RUN = "by_run"
    BY_MACHINE = "by_machine"
    BY_TIME_WINDOW = "by_time_window"
    STRATIFIED_RUN = "stratified_run"


@dataclass(frozen=True)
class SensorMeta:
    """Metadata describing a physical or derived sensor channel."""
    name: str
    physical_quantity: str  # e.g., "vibration_acceleration", "stator_current", "temperature"
    unit: str               # e.g., "g", "m/s^2", "A", "V", "degC", "RPM", "rad/s"
    sampling_rate_hz: Optional[float] = None
    location: Optional[str] = None          # e.g., "drive_end", "fan_end", "phase_a"
    sensor_type: Optional[str] = None       # e.g., "accelerometer", "hall_effect", "thermocouple"
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class OperatingCondition:
    """Operating condition descriptor (load, speed, pressure, ambient temp)."""
    name: str
    value: Union[float, int, str]
    unit: Optional[str] = None
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class FaultState:
    """Normalized fault description and severity."""
    is_anomaly: bool
    fault_type: Optional[str] = None        # e.g., "inner_race", "broken_rotor_bar", "healthy"
    severity: Optional[float] = None        # e.g., 0.007 (inches) or 1.0 (single bar)
    component: Optional[str] = None         # e.g., "bearing", "rotor", "stator", "winding"
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class NormalizedRecord:
    """Standardized single-time-step or windowed observation across industrial datasets.
    
    Preserves exact provenance while providing a unified schema for machine state,
    sensors, operating conditions, and diagnostic ground truth.
    """
    dataset_id: str
    machine_id: str
    run_id: str
    timestamp_s: float
    operating_conditions: Dict[str, Any] = field(default_factory=dict)
    sensor_readings: Dict[str, float] = field(default_factory=dict)
    sensor_metadata: Dict[str, SensorMeta] = field(default_factory=dict)
    fault_state: FaultState = field(default_factory=lambda: FaultState(is_anomaly=False, fault_type="healthy"))
    original_label: Optional[str] = None
    normalized_label: Optional[str] = None
    taxonomy_path: Optional[str] = None     # e.g., "mechanical.bearing.inner_race"
    provenance: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "machine_id": self.machine_id,
            "run_id": self.run_id,
            "timestamp_s": self.timestamp_s,
            "operating_conditions": dict(self.operating_conditions),
            "sensor_readings": dict(self.sensor_readings),
            "sensor_metadata": {k: v.to_dict() for k, v in self.sensor_metadata.items()},
            "fault_state": self.fault_state.to_dict(),
            "original_label": self.original_label,
            "normalized_label": self.normalized_label,
            "taxonomy_path": self.taxonomy_path,
            "provenance": dict(self.provenance),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


@dataclass
class DatasetManifest:
    """Formal, machine-readable manifest documenting an industrial dataset."""
    dataset_id: str
    version: str
    title: str
    domain: str                     # e.g., "rotating_machinery", "electric_motors"
    machine_type: str               # e.g., "induction_motor", "ball_bearing_test_rig"
    sensors: List[SensorMeta]
    sampling_rate_hz: Optional[float]
    operating_conditions: List[str] # List of condition variables tracked
    fault_types: List[str]          # Known fault classes present
    supported_tasks: List[DiagnosticTask]
    license_name: str
    citation: str
    source_url: Optional[str] = None
    limitations: List[str] = field(default_factory=list)
    checksum: Optional[str] = None
    notes: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "version": self.version,
            "title": self.title,
            "domain": self.domain,
            "machine_type": self.machine_type,
            "sensors": [s.to_dict() for s in self.sensors],
            "sampling_rate_hz": self.sampling_rate_hz,
            "operating_conditions": list(self.operating_conditions),
            "fault_types": list(self.fault_types),
            "supported_tasks": [t.value for t in self.supported_tasks],
            "license_name": self.license_name,
            "citation": self.citation,
            "source_url": self.source_url,
            "limitations": list(self.limitations),
            "checksum": self.checksum,
            "notes": self.notes,
        }


@dataclass
class DataQualityReport:
    """Comprehensive data quality, integrity, and sampling validation report."""
    dataset_id: str
    record_count: int
    run_count: int
    machine_count: int
    sensor_count: int
    missing_value_counts: Dict[str, int] = field(default_factory=dict)
    infinite_value_counts: Dict[str, int] = field(default_factory=dict)
    duplicate_records: int = 0
    non_monotonic_timestamps: int = 0
    sampling_rate_est_hz: Optional[float] = None
    label_distribution: Dict[str, int] = field(default_factory=dict)
    operating_condition_distribution: Dict[str, Dict[str, int]] = field(default_factory=dict)
    issues_detected: List[str] = field(default_factory=list)
    is_valid: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DatasetSplit:
    """Safe, leakage-free train/validation/test partition."""
    dataset_id: str
    strategy: SplitStrategy
    random_seed: int
    train_runs: List[str]
    val_runs: List[str]
    test_runs: List[str]
    train_count: int
    val_count: int
    test_count: int
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        res = asdict(self)
        res["strategy"] = self.strategy.value
        return res
