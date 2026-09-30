"""Task-oriented views over normalized industrial datasets.

Provides task-specific feature matrices and targets for:
- Anomaly Detection (nominal baseline vs faults, operating condition aware)
- Fault Classification (multi-class tabular features X, labels y)
- Continuous Condition Monitoring (time-series parameter tracking)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

from data_foundation.adapter import IndustrialDatasetAdapter
from data_foundation.schemas import NormalizedRecord


@dataclass
class AnomalyDetectionView:
    """View isolating healthy/nominal baseline from anomalous observations."""
    dataset_id: str
    normal_features: np.ndarray        # shape (N_normal, D)
    anomalous_features: np.ndarray     # shape (N_anom, D)
    feature_names: List[str]
    normal_runs: List[str]
    anomalous_runs: List[str]
    operating_conditions: List[Dict[str, Any]]

    @property
    def total_samples(self) -> int:
        return len(self.normal_features) + len(self.anomalous_features)

    @property
    def anomaly_ratio(self) -> float:
        return len(self.anomalous_features) / self.total_samples if self.total_samples > 0 else 0.0


@dataclass
class FaultClassificationView:
    """Multi-class classification feature matrix and targets."""
    dataset_id: str
    X: np.ndarray                       # shape (N, D)
    y: List[str]                        # length N labels
    feature_names: List[str]
    classes: List[str]
    class_counts: Dict[str, int]
    run_ids: List[str]

    @property
    def sample_count(self) -> int:
        return len(self.X)


class TaskViewExtractor:
    """Extracts task-specific matrices from an IndustrialDatasetAdapter."""

    @classmethod
    def get_classification_view(
        cls,
        adapter: IndustrialDatasetAdapter,
        feature_keys: Optional[List[str]] = None,
        run_ids: Optional[List[str]] = None,
    ) -> FaultClassificationView:
        """Extract multi-class feature matrix and labels from normalized records."""
        if not adapter.is_loaded:
            raise RuntimeError(f"Adapter {adapter.dataset_id} must be loaded")

        allowed_runs = set(run_ids) if run_ids is not None else None
        records: List[NormalizedRecord] = []
        for r in adapter.iter_records():
            if allowed_runs is None or r.run_id in allowed_runs:
                records.append(r)

        if not records:
            raise ValueError("No records found for classification view")

        # Determine feature keys if not provided
        if feature_keys is None:
            feature_keys = sorted(list(records[0].sensor_readings.keys()))

        X_rows = []
        y_labels = []
        record_runs = []
        class_counts: Dict[str, int] = {}

        for r in records:
            row = [float(r.sensor_readings.get(k, 0.0)) for k in feature_keys]
            lbl = r.normalized_label or r.original_label or "unknown"
            X_rows.append(row)
            y_labels.append(lbl)
            record_runs.append(r.run_id)
            class_counts[lbl] = class_counts.get(lbl, 0) + 1

        classes = sorted(list(class_counts.keys()))

        return FaultClassificationView(
            dataset_id=adapter.dataset_id,
            X=np.array(X_rows, dtype=np.float64),
            y=y_labels,
            feature_names=feature_keys,
            classes=classes,
            class_counts=class_counts,
            run_ids=record_runs,
        )

    @classmethod
    def get_anomaly_view(
        cls,
        adapter: IndustrialDatasetAdapter,
        feature_keys: Optional[List[str]] = None,
        run_ids: Optional[List[str]] = None,
    ) -> AnomalyDetectionView:
        """Extract normal vs anomalous feature sets."""
        if not adapter.is_loaded:
            raise RuntimeError(f"Adapter {adapter.dataset_id} must be loaded")

        allowed_runs = set(run_ids) if run_ids is not None else None
        records: List[NormalizedRecord] = []
        for r in adapter.iter_records():
            if allowed_runs is None or r.run_id in allowed_runs:
                records.append(r)

        if not records:
            raise ValueError("No records found for anomaly view")

        if feature_keys is None:
            feature_keys = sorted(list(records[0].sensor_readings.keys()))

        normal_rows = []
        anom_rows = []
        normal_runs = set()
        anom_runs = set()
        op_conds = []

        for r in records:
            row = [float(r.sensor_readings.get(k, 0.0)) for k in feature_keys]
            op_conds.append(r.operating_conditions)
            if r.fault_state.is_anomaly:
                anom_rows.append(row)
                anom_runs.add(r.run_id)
            else:
                normal_rows.append(row)
                normal_runs.add(r.run_id)

        X_normal = np.array(normal_rows, dtype=np.float64) if normal_rows else np.empty((0, len(feature_keys)))
        X_anom = np.array(anom_rows, dtype=np.float64) if anom_rows else np.empty((0, len(feature_keys)))

        return AnomalyDetectionView(
            dataset_id=adapter.dataset_id,
            normal_features=X_normal,
            anomalous_features=X_anom,
            feature_names=feature_keys,
            normal_runs=sorted(list(normal_runs)),
            anomalous_runs=sorted(list(anom_runs)),
            operating_conditions=op_conds,
        )
