"""Electric Motor Temperature (EMT) Dataset Adapter.

Handles ingestion of the Paderborn University Permanent Magnet Synchronous Motor (PMSM)
temperature dataset for thermal degradation, condition monitoring, and thermal anomaly detection.
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


class ElectricMotorTempAdapter(IndustrialDatasetAdapter):
    """Adapter for Paderborn University Electric Motor Temperature Dataset."""

    DATASET_ID = "electric_motor_temp"

    # Threshold for thermal anomaly on permanent magnet (°C)
    PM_ANOMALY_THRESHOLD_C = 100.0

    def __init__(self, source_path: Optional[Path] = None, max_records_per_profile: Optional[int] = 1000):
        default_path = Path("dataset/eletric_motor_temp_measures_v2.csv")
        super().__init__(source_path or default_path)
        self.max_records_per_profile = max_records_per_profile
        self._profiles: List[str] = []

    @property
    def dataset_id(self) -> str:
        return self.DATASET_ID

    @property
    def manifest(self) -> DatasetManifest:
        return DatasetManifest(
            dataset_id=self.DATASET_ID,
            version="2.0.0",
            title="Paderborn Electric Motor Temperature Dataset",
            domain="electric_vehicles_pmsm",
            machine_type="permanent_magnet_synchronous_motor",
            sensors=[
                SensorMeta(name="u_d", physical_quantity="voltage", unit="V", location="dq_frame", description="Direct axis stator voltage"),
                SensorMeta(name="u_q", physical_quantity="voltage", unit="V", location="dq_frame", description="Quadrature axis stator voltage"),
                SensorMeta(name="i_d", physical_quantity="current", unit="A", location="dq_frame", description="Direct axis stator current"),
                SensorMeta(name="i_q", physical_quantity="current", unit="A", location="dq_frame", description="Quadrature axis stator current"),
                SensorMeta(name="motor_speed", physical_quantity="angular_velocity", unit="RPM", location="rotor_shaft", description="Motor rotor rotational speed"),
                SensorMeta(name="torque", physical_quantity="torque", unit="Nm", location="rotor_shaft", description="Shaft mechanical torque"),
                SensorMeta(name="ambient", physical_quantity="temperature", unit="degC", location="environment", description="Ambient environmental temperature"),
                SensorMeta(name="coolant", physical_quantity="temperature", unit="degC", location="cooling_jacket", description="Coolant fluid inlet temperature"),
                SensorMeta(name="stator_winding", physical_quantity="temperature", unit="degC", location="stator", description="Stator winding temperature"),
                SensorMeta(name="stator_tooth", physical_quantity="temperature", unit="degC", location="stator", description="Stator tooth core temperature"),
                SensorMeta(name="stator_yoke", physical_quantity="temperature", unit="degC", location="stator", description="Stator yoke core temperature"),
                SensorMeta(name="pm", physical_quantity="temperature", unit="degC", location="rotor_magnets", description="Permanent magnet temperature"),
            ],
            sampling_rate_hz=2.0,
            operating_conditions=["motor_speed", "torque", "ambient", "coolant"],
            fault_types=["pm_thermal_overload", "stator_overheating", "nominal"],
            supported_tasks=[
                DiagnosticTask.ANOMALY_DETECTION,
                DiagnosticTask.AUXILIARY,
            ],
            license_name="CC BY-SA 4.0 (Paderborn University)",
            citation=(
                "Kirchgässner, W., Wallscheid, O., & Böcker, J. (2021). "
                "'Empirical Evaluation of Electric Motor Thermal Modeling using "
                "Recurrent Neural Networks'. IEEE Transactions on Industrial Informatics."
            ),
            source_url="https://www.kaggle.com/datasets/wkirgsn/electric-motor-temperature",
            limitations=[
                "Does NOT contain discrete mechanical failure classes (no bearing, gear, or broken bar labels).",
                "Voltages and currents are normalized in field-oriented d/q reference frames.",
                "Measurements are uniform 2 Hz continuous operating cycles on an automated dynamometer test bench.",
            ],
            notes="69 test bench measurement profiles under dynamic WLTP-like driving cycles.",
        )

    def get_runs(self) -> List[str]:
        return [f"profile_{p}" for p in self._profiles]

    def get_label_mapping(self) -> Dict[str, str]:
        return {
            "nominal": "healthy",
            "pm_thermal_overload": "pm_overheating",
        }

    def get_taxonomy_mapping(self) -> Dict[str, str]:
        return {
            "healthy": "healthy.baseline",
            "pm_overheating": "thermal.permanent_magnet.overheating",
        }

    def load(self, source_path: Optional[Path] = None) -> None:
        p = Path(source_path or self._source_path)
        if not p.exists():
            raise FileNotFoundError(f"Electric motor temp CSV not found: {p}")

        # Scan unique profile IDs
        profiles = set()
        with open(p, mode="r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader)
            pid_idx = header.index("profile_id")
            for row in reader:
                if row:
                    profiles.add(row[pid_idx])

        self._profiles = sorted(list(profiles), key=lambda x: int(x) if x.isdigit() else x)
        self._is_loaded = True

    def iter_records(self, run_id: Optional[str] = None) -> Iterator[NormalizedRecord]:
        if not self._is_loaded:
            self.load()

        if run_id is not None:
            clean_pid = run_id.replace("profile_", "")
            target_profiles = {clean_pid}
        else:
            target_profiles = set(self._profiles)
        p = Path(self._source_path)

        with open(p, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            profile_counts: Dict[str, int] = {}
            profile_step: Dict[str, int] = {}

            for row in reader:
                pid = row["profile_id"]
                if pid not in target_profiles:
                    continue

                count = profile_counts.get(pid, 0)
                if self.max_records_per_profile and count >= self.max_records_per_profile:
                    continue

                step = profile_step.get(pid, 0)
                profile_step[pid] = step + 1
                profile_counts[pid] = count + 1

                t_s = round(step * 0.5, 2)  # 2 Hz sampling = 0.5s per step
                pm_temp = float(row["pm"])
                is_anom = pm_temp > self.PM_ANOMALY_THRESHOLD_C
                norm_label = "pm_overheating" if is_anom else "healthy"
                tax_path = "thermal.permanent_magnet.overheating" if is_anom else "healthy.baseline"

                readings = {
                    "u_d": float(row["u_d"]),
                    "u_q": float(row["u_q"]),
                    "i_d": float(row["i_d"]),
                    "i_q": float(row["i_q"]),
                    "motor_speed_rpm": float(row["motor_speed"]),
                    "torque_nm": float(row["torque"]),
                    "ambient_c": float(row["ambient"]),
                    "coolant_c": float(row["coolant"]),
                    "stator_winding_c": float(row["stator_winding"]),
                    "stator_tooth_c": float(row["stator_tooth"]),
                    "stator_yoke_c": float(row["stator_yoke"]),
                    "pm_c": pm_temp,
                }

                record = NormalizedRecord(
                    dataset_id=self.DATASET_ID,
                    machine_id="paderborn_pmsm_dynamometer",
                    run_id=f"profile_{pid}",
                    timestamp_s=t_s,
                    operating_conditions={
                        "profile_id": int(pid) if pid.isdigit() else pid,
                        "motor_speed_rpm": float(row["motor_speed"]),
                        "torque_nm": float(row["torque"]),
                        "ambient_c": float(row["ambient"]),
                        "coolant_c": float(row["coolant"]),
                    },
                    sensor_readings=readings,
                    fault_state=FaultState(
                        is_anomaly=is_anom,
                        fault_type=norm_label,
                        severity=round(pm_temp - self.PM_ANOMALY_THRESHOLD_C, 2) if is_anom else 0.0,
                        component="permanent_magnet" if is_anom else None,
                        description=FaultTaxonomy.get_description(tax_path) or norm_label,
                    ),
                    original_label="pm_over_100c" if is_anom else "nominal",
                    normalized_label=norm_label,
                    taxonomy_path=tax_path,
                    provenance={
                        "source_file": p.name,
                        "sampling_rate_hz": 2.0,
                        "profile_id": pid,
                    },
                )
                yield record

    def validate(self) -> DataQualityReport:
        validator = DatasetValidator(self.DATASET_ID)
        return validator.validate_records(self.iter_records())
