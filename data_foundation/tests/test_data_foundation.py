"""Comprehensive test suite for MachSight Data Foundation Layer.

Tests:
- Schema contracts and immutability
- Hierarchical Fault Taxonomy
- Dataset Registry and Manifests
- CWRU Bearing, MCSADC Rotor Bar, and Electric Motor Temp Adapters
- Dataset Validators and Data Quality Reports
- Data Leakage Detection (run overlap, label leakage)
- Preprocessing and Unit Normalization
- Task-oriented View Extraction (Anomaly Detection, Fault Classification)
"""

from pathlib import Path
import pytest
import numpy as np

from data_foundation import (
    DiagnosticTask,
    SplitStrategy,
    SensorMeta,
    OperatingCondition,
    FaultState,
    NormalizedRecord,
    FaultTaxonomy,
    IndustrialDatasetAdapter,
    DatasetRegistry,
    DatasetValidator,
    LeakageDetector,
    Preprocessor,
    TaskViewExtractor,
    CWRUBearingAdapter,
    MCSADCRotorAdapter,
    ElectricMotorTempAdapter,
)


def test_schema_contracts():
    """Verify NormalizedRecord serialization and schema integrity."""
    rec = NormalizedRecord(
        dataset_id="test_ds",
        machine_id="machine_01",
        run_id="run_01",
        timestamp_s=1.25,
        operating_conditions={"load_hp": 2.0},
        sensor_readings={"vibration": 0.42, "current": 3.14},
        sensor_metadata={
            "vibration": SensorMeta(
                name="vibration",
                physical_quantity="vibration_acceleration",
                unit="g",
                location="drive_end",
            )
        },
        fault_state=FaultState(
            is_anomaly=True,
            fault_type="bearing_ball",
            severity=0.014,
            component="bearing",
        ),
        original_label="Ball_014",
        normalized_label="bearing_ball_014",
        taxonomy_path="mechanical.bearing.ball",
        provenance={"source": "test_fixture"},
    )

    d = rec.to_dict()
    assert d["dataset_id"] == "test_ds"
    assert d["sensor_readings"]["vibration"] == 0.42
    assert d["fault_state"]["is_anomaly"] is True
    assert d["sensor_metadata"]["vibration"]["unit"] == "g"

    json_str = rec.to_json()
    assert "bearing_ball_014" in json_str


def test_taxonomy_hierarchy():
    """Verify FaultTaxonomy path resolution, categories, and component inference."""
    assert FaultTaxonomy.is_valid_path("mechanical.bearing.inner_race")
    assert FaultTaxonomy.is_valid_path("electrical.rotor.broken_bar_1")
    assert FaultTaxonomy.is_valid_path("healthy")
    assert not FaultTaxonomy.is_valid_path("invented.invalid.fault")

    # Component & system inference
    assert FaultTaxonomy.get_component("mechanical.bearing.inner_race") == "bearing"
    assert FaultTaxonomy.get_system("mechanical.bearing.inner_race") == "drive_train"
    assert FaultTaxonomy.get_component("electrical.rotor.broken_bar_1") == "rotor"
    assert FaultTaxonomy.get_system("electrical.rotor.broken_bar_1") == "electromagnetic"

    # Category and parent path
    assert FaultTaxonomy.get_category("mechanical.bearing.ball") == "mechanical"
    assert FaultTaxonomy.get_category("electrical.rotor.broken_bar_2") == "electrical"
    assert FaultTaxonomy.get_parent_path("mechanical.bearing.ball") == "mechanical.bearing"
    assert FaultTaxonomy.get_parent_path("healthy") is None


def test_dataset_registry():
    """Verify DatasetRegistry lists adapters and instantiates by ID."""
    datasets = DatasetRegistry.list_datasets()
    assert "cwru_bearing" in datasets
    assert "mcsadc_rotor_bar" in datasets
    assert "electric_motor_temp" in datasets

    adapter = DatasetRegistry.get("cwru_bearing")
    assert isinstance(adapter, CWRUBearingAdapter)
    assert adapter.dataset_id == "cwru_bearing"

    with pytest.raises(KeyError):
        DatasetRegistry.get("non_existent_dataset")


def test_cwru_bearing_adapter():
    """Verify CWRUBearingAdapter loading, normalization, and quality validation."""
    adapter = CWRUBearingAdapter()
    manifest = adapter.manifest
    assert manifest.dataset_id == "cwru_bearing"
    assert "de_vibration" in [s.name for s in manifest.sensors]
    assert DiagnosticTask.FAULT_CLASSIFICATION in manifest.supported_tasks

    adapter.load()
    assert adapter.is_loaded
    runs = adapter.get_runs()
    assert len(runs) >= 10
    assert any("Normal" in r for r in runs)
    assert any("IR" in r for r in runs)

    # Test iterating records
    records = list(adapter.iter_records())
    assert len(records) > 0
    first = records[0]
    assert "rms" in first.sensor_readings
    assert "kurtosis" in first.sensor_readings
    assert first.operating_conditions["motor_load_hp"] == 1.0

    # Test data quality report
    report = adapter.validate()
    assert report.is_valid
    assert report.record_count == len(records)
    assert report.run_count == len(runs)
    assert "healthy" in report.label_distribution

    # Test leakage-free split
    split = adapter.create_splits(strategy=SplitStrategy.BY_RUN, seed=42, test_ratio=0.2, val_ratio=0.1)
    violations = LeakageDetector.check_split_leakage(split)
    assert len(violations) == 0
    assert len(split.train_runs) > 0
    assert len(split.test_runs) > 0


def test_mcsadc_rotor_adapter():
    """Verify MCSADCRotorAdapter loading, unit conversion, and fault conditions."""
    # Use max_points_per_file to keep unit test fast
    adapter = MCSADCRotorAdapter(max_points_per_file=50)
    manifest = adapter.manifest
    assert manifest.dataset_id == "mcsadc_rotor_bar"
    assert "i_sa" in [s.name for s in manifest.sensors]

    adapter.load()
    assert adapter.is_loaded
    runs = adapter.get_runs()
    assert len(runs) == 162

    # Sample a healthy run and a broken run
    healthy_recs = list(adapter.iter_records(run_id="ccs_000"))
    assert len(healthy_recs) == 50
    assert healthy_recs[0].normalized_label == "healthy"
    assert healthy_recs[0].fault_state.is_anomaly is False
    assert "i_sa" in healthy_recs[0].sensor_readings
    assert "speed_rpm" in healthy_recs[0].sensor_readings
    # Ensure speed in RPM was converted correctly from ~301.5 rad/s (~2880 or ~1435 RPM regime)
    assert healthy_recs[0].sensor_readings["speed_rpm"] > 1000

    broken_recs = list(adapter.iter_records(run_id="ccs_060"))
    assert len(broken_recs) == 50
    assert broken_recs[0].normalized_label == "broken_rotor_bar_1"
    assert broken_recs[0].fault_state.is_anomaly is True
    assert broken_recs[0].taxonomy_path == "electrical.rotor.broken_bar_1"

    # Test leakage-free split
    split = adapter.create_splits(strategy=SplitStrategy.BY_RUN, seed=123)
    violations = LeakageDetector.check_split_leakage(split)
    assert len(violations) == 0


def test_electric_motor_temp_adapter():
    """Verify ElectricMotorTempAdapter loading and thermal anomaly categorization."""
    # Sample up to 100 records per profile for fast testing
    adapter = ElectricMotorTempAdapter(max_records_per_profile=50)
    manifest = adapter.manifest
    assert manifest.dataset_id == "electric_motor_temp"
    assert "pm" in [s.name for s in manifest.sensors]

    adapter.load()
    assert adapter.is_loaded
    profiles = adapter.get_runs()
    assert len(profiles) == 69

    # Test single profile records
    recs = list(adapter.iter_records(run_id="profile_17"))
    assert len(recs) == 50
    assert "pm_c" in recs[0].sensor_readings
    assert "motor_speed_rpm" in recs[0].sensor_readings
    assert recs[0].dataset_id == "electric_motor_temp"


def test_leakage_detector_violations():
    """Verify that LeakageDetector correctly flags intentional leakage."""
    from data_foundation.schemas import DatasetSplit

    # 1. Run overlap leakage
    bad_split = DatasetSplit(
        dataset_id="test",
        strategy=SplitStrategy.BY_RUN,
        random_seed=42,
        train_runs=["run_01", "run_02", "run_03"],
        val_runs=["run_03"],  # Overlap!
        test_runs=["run_02"], # Overlap!
        train_count=10,
        val_count=5,
        test_count=5,
    )
    violations = LeakageDetector.check_split_leakage(bad_split)
    assert len(violations) >= 2

    # 2. Label leakage in features
    bad_features = ["motor_current", "vibration_rms", "fault_type_encoded", "is_anomaly_flag"]
    label_violations = LeakageDetector.check_label_leakage(bad_features)
    assert len(label_violations) == 2
    assert any("fault_type_encoded" in v for v in label_violations)
    assert any("is_anomaly_flag" in v for v in label_violations)

    good_features = ["motor_current", "vibration_rms", "temperature_c"]
    assert len(LeakageDetector.check_label_leakage(good_features)) == 0


def test_preprocessor_unit_conversion():
    """Verify verified physical unit conversions and error handling."""
    # rad/s to RPM
    rpm = Preprocessor.convert_unit(100.0, "rad/s", "RPM")
    assert round(rpm, 2) == 954.93

    # RPM to rad/s
    rad_s = Preprocessor.convert_unit(rpm, "RPM", "rad/s")
    assert round(rad_s, 2) == 100.0

    # mA to A
    amps = Preprocessor.convert_unit(2500.0, "mA", "A")
    assert amps == 2.5

    # g to m/s^2
    accel = Preprocessor.convert_unit(1.0, "g", "m/s^2")
    assert round(accel, 2) == 9.81

    # Unsupported
    with pytest.raises(ValueError):
        Preprocessor.convert_unit(10.0, "degC", "RPM")


def test_preprocessor_window_features():
    """Verify statistical feature extraction over signals."""
    signal = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    feats = Preprocessor.compute_window_features(signal)

    assert feats["max"] == 5.0
    assert feats["min"] == 1.0
    assert feats["peak_to_peak"] == 4.0
    assert feats["mean"] == 3.0
    assert feats["rms"] > 3.0
    assert "kurtosis" in feats
    assert "crest_factor" in feats
    assert "form_factor" in feats


def test_task_views():
    """Verify AnomalyDetectionView and FaultClassificationView extraction."""
    adapter = CWRUBearingAdapter()
    adapter.load()

    # 1. Classification view
    class_view = TaskViewExtractor.get_classification_view(adapter)
    assert class_view.sample_count > 0
    assert len(class_view.classes) >= 4
    assert class_view.X.shape[0] == len(class_view.y)
    assert class_view.X.shape[1] == len(class_view.feature_names)
    assert "healthy" in class_view.classes

    # 2. Anomaly detection view
    anom_view = TaskViewExtractor.get_anomaly_view(adapter)
    assert anom_view.total_samples == class_view.sample_count
    assert len(anom_view.normal_features) > 0
    assert len(anom_view.anomalous_features) > 0
    assert 0.0 < anom_view.anomaly_ratio < 1.0
