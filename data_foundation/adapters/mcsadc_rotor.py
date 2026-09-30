"""MCSA-DC Motor Current Signature Analysis Adapter for Broken Rotor Bar Failure.

Ingests experimental test bench data from LIAS Laboratory (University of Poitiers)
for healthy, 1 broken bar, and 2 broken rotor bar conditions across multiple speed regimes.
"""

from __future__ import annotations

import csv
from pathlib import Path
import re
from typing import Any, Dict, Iterator, List, Optional
import numpy as np

from data_foundation.adapter import IndustrialDatasetAdapter
from data_foundation.preprocessor import Preprocessor
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


class MCSADCRotorAdapter(IndustrialDatasetAdapter):
    """Adapter for LIAS Laboratory MCSA Broken Rotor Bar Dataset."""

    DATASET_ID = "mcsadc_rotor_bar"

    def __init__(self, source_path: Optional[Path] = None, max_points_per_file: Optional[int] = 1000):
        default_path = Path("dataset/mcsadc-motor-rotorbarfailure-1_2023")
        super().__init__(source_path or default_path)
        self.max_points_per_file = max_points_per_file
        self._file_map: Dict[str, Path] = {}
        self._runs: List[str] = []

    @property
    def dataset_id(self) -> str:
        return self.DATASET_ID

    @property
    def manifest(self) -> DatasetManifest:
        return DatasetManifest(
            dataset_id=self.DATASET_ID,
            version="1.0.0",
            title="LIAS MCSA Motor Broken Rotor Bar Dataset",
            domain="electric_motors",
            machine_type="three_phase_induction_motor_1_1kw",
            sensors=[
                SensorMeta(
                    name="i_sa",
                    physical_quantity="stator_current",
                    unit="A",
                    sampling_rate_hz=1428.57,
                    location="phase_a",
                    sensor_type="hall_effect_sensor",
                    description="Stator current phase A",
                ),
                SensorMeta(
                    name="i_sb",
                    physical_quantity="stator_current",
                    unit="A",
                    sampling_rate_hz=1428.57,
                    location="phase_b",
                    sensor_type="hall_effect_sensor",
                    description="Stator current phase B",
                ),
                SensorMeta(
                    name="i_sc",
                    physical_quantity="stator_current",
                    unit="A",
                    sampling_rate_hz=1428.57,
                    location="phase_c",
                    sensor_type="hall_effect_sensor",
                    description="Stator current phase C",
                ),
                SensorMeta(
                    name="v_sa",
                    physical_quantity="stator_voltage",
                    unit="V",
                    sampling_rate_hz=1428.57,
                    location="phase_a",
                    sensor_type="voltage_transducer",
                    description="Stator line-to-neutral voltage phase A",
                ),
                SensorMeta(
                    name="v_sb",
                    physical_quantity="stator_voltage",
                    unit="V",
                    sampling_rate_hz=1428.57,
                    location="phase_b",
                    sensor_type="voltage_transducer",
                    description="Stator line-to-neutral voltage phase B",
                ),
                SensorMeta(
                    name="v_sc",
                    physical_quantity="stator_voltage",
                    unit="V",
                    sampling_rate_hz=1428.57,
                    location="phase_c",
                    sensor_type="voltage_transducer",
                    description="Stator line-to-neutral voltage phase C",
                ),
                SensorMeta(
                    name="motor_speed_rad_s",
                    physical_quantity="angular_velocity",
                    unit="rad/s",
                    sampling_rate_hz=1428.57,
                    location="rotor_shaft",
                    sensor_type="optical_encoder",
                    description="Mechanical rotor speed in rad/s",
                ),
                SensorMeta(
                    name="rotor_position_rad",
                    physical_quantity="angular_position",
                    unit="rad",
                    sampling_rate_hz=1428.57,
                    location="rotor_shaft",
                    sensor_type="optical_encoder",
                    description="Rotor mechanical angular position in rad",
                ),
            ],
            sampling_rate_hz=1428.57,
            operating_conditions=["speed_regime_rpm", "motor_rated_power_kw"],
            fault_types=["healthy", "broken_rotor_bar_1", "broken_rotor_bar_2"],
            supported_tasks=[
                DiagnosticTask.FAULT_CLASSIFICATION,
                DiagnosticTask.ANOMALY_DETECTION,
            ],
            license_name="Open Research Attribution License (LIAS Laboratory, University of Poitiers)",
            citation=(
                "Boushaba, A.; Cauet, S.; Chamroo, A.; Etien, E.; Rambault, L. "
                "'Comparative Study between Physics-Informed CNN and PCA in Induction Motor "
                "Broken Bars MCSA Detection'. Sensors 2022, 22, 9494."
            ),
            source_url="https://github.com/LIAS-Lab/MCSA-DC",
            limitations=[
                "Artificially drilled rotor bars rather than thermal fatigue breakage.",
                "Steady state operation under three discrete speed/load setpoints.",
            ],
            notes="162 runs (18 runs per speed/fault configuration: low/med/high speed x healthy/1-bar/2-bar).",
        )

    def get_runs(self) -> List[str]:
        return list(self._runs)

    def get_label_mapping(self) -> Dict[str, str]:
        return {
            "healthy": "healthy",
            "broken_rotor_bar_1": "broken_rotor_bar_1",
            "broken_rotor_bar_2": "broken_rotor_bar_2",
        }

    def get_taxonomy_mapping(self) -> Dict[str, str]:
        return {
            "healthy": "healthy.baseline",
            "broken_rotor_bar_1": "electrical.rotor.broken_bar_1",
            "broken_rotor_bar_2": "electrical.rotor.broken_bar_2",
        }

    @staticmethod
    def _parse_file_metadata(file_name: str) -> Dict[str, Any]:
        """Determine health state and speed regime from ccs<id>.csv filename."""
        m = re.match(r"ccs(\d+)\.csv", file_name)
        if not m:
            return {"fault": "unknown", "speed_regime": "unknown", "run_id": file_name}
        fid = int(m.group(1))

        # Fault condition:
        # Healthy: 0-17, 20-37, 40-57
        # 1 Broken: 60-77, 80-97, 100-117
        # 2 Broken: 120-137, 140-157, 160-177
        if 0 <= fid <= 57:
            fault = "healthy"
            severity = 0.0
        elif 60 <= fid <= 117:
            fault = "broken_rotor_bar_1"
            severity = 1.0
        elif 120 <= fid <= 177:
            fault = "broken_rotor_bar_2"
            severity = 2.0
        else:
            fault = "unknown"
            severity = None

        # Speed regime:
        # Low (~1435 RPM): 0-17, 60-77, 120-137
        # Med (~1463 RPM): 20-37, 80-97, 140-157
        # High (~1491 RPM): 40-57, 100-117, 160-177
        mod = fid % 60
        if 0 <= mod <= 17:
            speed = "low_1435_rpm"
            speed_rpm = 1435.0
        elif 20 <= mod <= 37:
            speed = "med_1463_rpm"
            speed_rpm = 1463.0
        elif 40 <= mod <= 57:
            speed = "high_1491_rpm"
            speed_rpm = 1491.0
        else:
            speed = "unknown"
            speed_rpm = 1425.0

        return {
            "fault": fault,
            "severity": severity,
            "speed_regime": speed,
            "speed_rpm": speed_rpm,
            "run_id": f"ccs_{fid:03d}",
        }

    def load(self, source_path: Optional[Path] = None) -> None:
        p = Path(source_path or self._source_path)
        csv_files = sorted(list(p.glob("ccs*.csv")), key=lambda x: int(re.search(r"\d+", x.name).group()))
        self._file_map = {}
        self._runs = []

        for f in csv_files:
            meta = self._parse_file_metadata(f.name)
            run_id = meta["run_id"]
            self._file_map[run_id] = f
            self._runs.append(run_id)

        self._is_loaded = True

    def iter_records(self, run_id: Optional[str] = None) -> Iterator[NormalizedRecord]:
        if not self._is_loaded:
            self.load()

        targets = [run_id] if run_id is not None else self._runs
        tax_map = self.get_taxonomy_mapping()

        for rid in targets:
            if rid not in self._file_map:
                continue
            csv_path = self._file_map[rid]
            meta = self._parse_file_metadata(csv_path.name)
            norm_fault = meta["fault"]
            tax_path = tax_map.get(norm_fault, "electrical.rotor.broken_bar")
            is_anom = (norm_fault != "healthy")

            with open(csv_path, mode="r", encoding="utf-8") as f:
                reader = csv.reader(f)
                points = 0
                for row in reader:
                    if not row or len(row) < 9:
                        continue
                    try:
                        t = float(row[0])
                        i_sa = float(row[1])
                        i_sb = float(row[2])
                        i_sc = float(row[3])
                        v_sa = float(row[4])
                        v_sb = float(row[5])
                        v_sc = float(row[6])
                        speed_rad = float(row[7])
                        pos_rad = float(row[8])
                    except ValueError:
                        continue

                    # Explicit unit conversion: speed rad/s to RPM
                    speed_rpm = Preprocessor.convert_unit(speed_rad, "rad/s", "RPM")

                    readings = {
                        "i_sa": i_sa,
                        "i_sb": i_sb,
                        "i_sc": i_sc,
                        "v_sa": v_sa,
                        "v_sb": v_sb,
                        "v_sc": v_sc,
                        "speed_rad_s": speed_rad,
                        "speed_rpm": round(speed_rpm, 2),
                        "position_rad": pos_rad,
                    }

                    record = NormalizedRecord(
                        dataset_id=self.DATASET_ID,
                        machine_id="poitiers_induction_motor_1_1kw",
                        run_id=rid,
                        timestamp_s=t,
                        operating_conditions={
                            "speed_regime": meta["speed_regime"],
                            "speed_rpm_nominal": meta["speed_rpm"],
                            "motor_power_kw": 1.1,
                        },
                        sensor_readings=readings,
                        fault_state=FaultState(
                            is_anomaly=is_anom,
                            fault_type=norm_fault,
                            severity=meta["severity"],
                            component="rotor_squirrel_cage" if is_anom else None,
                            description=FaultTaxonomy.get_description(tax_path) or norm_fault,
                        ),
                        original_label=norm_fault,
                        normalized_label=norm_fault,
                        taxonomy_path=tax_path,
                        provenance={
                            "source_file": csv_path.name,
                            "sampling_rate_hz": 1428.57,
                        },
                    )
                    yield record

                    points += 1
                    if self.max_points_per_file and points >= self.max_points_per_file:
                        break

    def validate(self) -> DataQualityReport:
        validator = DatasetValidator(self.DATASET_ID)
        return validator.validate_records(self.iter_records())
