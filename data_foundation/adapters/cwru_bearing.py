"""CWRU Bearing Dataset Adapter.

Handles ingestion, normalization, and validation of Case Western Reserve University
vibration acceleration data for induction motor rolling element bearing diagnostics.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional
import numpy as np

from data_foundation.adapter import IndustrialDatasetAdapter
from data_foundation.schemas import (
    DataQualityReport,
    DatasetManifest,
    DiagnosticTask,
    FaultState,
    NormalizedRecord,
    SensorMeta,
)
from data_foundation.taxonomy import FaultTaxonomy
from data_foundation.validators import DatasetValidator


class CWRUBearingAdapter(IndustrialDatasetAdapter):
    """Adapter for Case Western Reserve University (CWRU) Bearing Dataset."""

    DATASET_ID = "cwru_bearing"

    def __init__(self, source_path: Optional[Path] = None):
        default_path = Path("dataset/bearing_dataset")
        super().__init__(source_path or default_path)
        self._records: List[NormalizedRecord] = []
        self._runs: List[str] = []

    @property
    def dataset_id(self) -> str:
        return self.DATASET_ID

    @property
    def manifest(self) -> DatasetManifest:
        return DatasetManifest(
            dataset_id=self.DATASET_ID,
            version="1.0.0",
            title="CWRU Bearing Vibration Dataset (48k Load 1)",
            domain="rotating_machinery",
            machine_type="reliance_electric_2hp_motor",
            sensors=[
                SensorMeta(
                    name="de_vibration",
                    physical_quantity="vibration_acceleration",
                    unit="g",
                    sampling_rate_hz=48000.0,
                    location="drive_end",
                    sensor_type="accelerometer",
                    description="Drive end bearing housing vibration acceleration",
                ),
                SensorMeta(
                    name="fe_vibration",
                    physical_quantity="vibration_acceleration",
                    unit="g",
                    sampling_rate_hz=48000.0,
                    location="fan_end",
                    sensor_type="accelerometer",
                    description="Fan end bearing housing vibration acceleration",
                ),
            ],
            sampling_rate_hz=48000.0,
            operating_conditions=["motor_load_hp", "motor_speed_rpm"],
            fault_types=["ball", "inner_race", "outer_race"],
            supported_tasks=[
                DiagnosticTask.FAULT_CLASSIFICATION,
                DiagnosticTask.ANOMALY_DETECTION,
            ],
            license_name="Public Academic Domain (Case Western Reserve University)",
            citation=(
                "Loparo, K. A., 'Bearing Vibration Data Set', "
                "Case Western Reserve University Data Center, 2012."
            ),
            source_url="https://engineering.case.edu/bearingdatacenter",
            limitations=[
                "Artificial EDM electro-discharge machining pit faults, not naturally grown fatigue spalls.",
                "Steady-state operational bench tests with constant motor load (no transient speed cycles).",
                "Single drive-end bearing tested at a time.",
            ],
            notes="Processed 2048-point windows with standard statistical features for Load 1 (~1772 RPM).",
        )

    def get_runs(self) -> List[str]:
        return list(self._runs)

    def get_label_mapping(self) -> Dict[str, str]:
        return {
            "Normal_1": "healthy",
            "Normal": "healthy",
            "Ball_007_1": "bearing_ball_007",
            "Ball_014_1": "bearing_ball_014",
            "Ball_021_1": "bearing_ball_021",
            "Ball_007": "bearing_ball_007",
            "Ball_014": "bearing_ball_014",
            "Ball_021": "bearing_ball_021",
            "IR_007_1": "bearing_inner_race_007",
            "IR_014_1": "bearing_inner_race_014",
            "IR_021_1": "bearing_inner_race_021",
            "IR_007": "bearing_inner_race_007",
            "IR_014": "bearing_inner_race_014",
            "IR_021": "bearing_inner_race_021",
            "OR_007_6_1": "bearing_outer_race_007",
            "OR_014_6_1": "bearing_outer_race_014",
            "OR_021_6_1": "bearing_outer_race_021",
            "OR_007": "bearing_outer_race_007",
            "OR_014": "bearing_outer_race_014",
            "OR_021": "bearing_outer_race_021",
        }

    def get_taxonomy_mapping(self) -> Dict[str, str]:
        return {
            "healthy": "healthy.baseline",
            "bearing_ball_007": "mechanical.bearing.ball",
            "bearing_ball_014": "mechanical.bearing.ball",
            "bearing_ball_021": "mechanical.bearing.ball",
            "bearing_inner_race_007": "mechanical.bearing.inner_race",
            "bearing_inner_race_014": "mechanical.bearing.inner_race",
            "bearing_inner_race_021": "mechanical.bearing.inner_race",
            "bearing_outer_race_007": "mechanical.bearing.outer_race",
            "bearing_outer_race_014": "mechanical.bearing.outer_race",
            "bearing_outer_race_021": "mechanical.bearing.outer_race",
        }

    def load(self, source_path: Optional[Path] = None) -> None:
        p = Path(source_path or self._source_path)
        feature_csv = p / "feature_time_48k_2048_load_1.csv"
        
        self._records = []
        runs_set = set()

        if feature_csv.exists():
            with open(feature_csv, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                label_map = self.get_label_mapping()
                tax_map = self.get_taxonomy_mapping()

                for idx, row in enumerate(reader):
                    raw_fault = row.get("fault", "Unknown")
                    norm_label = label_map.get(raw_fault, raw_fault.lower())
                    tax_path = tax_map.get(norm_label, "mechanical.bearing")
                    is_anomaly = (norm_label != "healthy")

                    run_id = f"run_{raw_fault}"
                    runs_set.add(run_id)

                    # Extract statistical sensor features computed for this 2048-point window
                    readings = {
                        "max": float(row["max"]),
                        "min": float(row["min"]),
                        "mean": float(row["mean"]),
                        "std": float(row["sd"]),
                        "rms": float(row["rms"]),
                        "skewness": float(row["skewness"]),
                        "kurtosis": float(row["kurtosis"]),
                        "crest_factor": float(row["crest"]),
                        "form_factor": float(row["form"]),
                    }

                    record = NormalizedRecord(
                        dataset_id=self.DATASET_ID,
                        machine_id="reliance_motor_cwru_01",
                        run_id=run_id,
                        timestamp_s=round(idx * (2048.0 / 48000.0), 4),
                        operating_conditions={
                            "motor_load_hp": 1.0,
                            "motor_speed_rpm": 1772,
                        },
                        sensor_readings=readings,
                        fault_state=FaultState(
                            is_anomaly=is_anomaly,
                            fault_type=norm_label,
                            severity=0.007 if "007" in raw_fault else (0.014 if "014" in raw_fault else (0.021 if "021" in raw_fault else None)),
                            component="drive_end_bearing" if is_anomaly else None,
                            description=FaultTaxonomy.get_description(tax_path) or raw_fault,
                        ),
                        original_label=raw_fault,
                        normalized_label=norm_label,
                        taxonomy_path=tax_path,
                        provenance={
                            "source_file": feature_csv.name,
                            "window_size": 2048,
                            "sampling_rate_hz": 48000,
                        },
                    )
                    self._records.append(record)

        self._runs = sorted(list(runs_set))
        self._is_loaded = True

    def iter_records(self, run_id: Optional[str] = None) -> Iterator[NormalizedRecord]:
        if not self._is_loaded:
            self.load()
        for r in self._records:
            if run_id is None or r.run_id == run_id:
                yield r

    def validate(self) -> DataQualityReport:
        validator = DatasetValidator(self.DATASET_ID)
        return validator.validate_records(self.iter_records())
