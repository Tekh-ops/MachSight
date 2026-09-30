# Phase 5: Industrial Dataset Integration & Data Foundation Layer

## 1. Executive Summary

Phase 5 establishes a production-grade, trustworthy, and reproducible **Industrial Dataset Foundation Layer** for MachSight.

Prior to Phase 5, MachSight had ad-hoc dataset files (CWRU `.mat`/`.csv`, MCSA broken rotor bar CSVs, and electric motor temperature CSVs) with varying formats, missing unit semantics, and unvalidated schemas.

Phase 5 achieves:
1. **Strong Separation of Concerns:** Preserves the MachSight-Simulator streaming contract for RC-car hardware while introducing an isolated, strongly-typed `data_foundation` package for industrial datasets.
2. **Normalized Data Model:** Built `NormalizedRecord`, `SensorMeta`, `OperatingCondition`, `FaultState`, and `DatasetManifest`.
3. **Hierarchical Fault Taxonomy:** Implemented `FaultTaxonomy` spanning mechanical, electrical, thermal, and sensor fault modes with automatic component and system inference.
4. **Concrete Industrial Adapters:** Implemented adapters for:
   * **CWRU Bearing Vibration Dataset** (`cwru_bearing`)
   * **LIAS MCSA Broken Rotor Bar Dataset** (`mcsadc_rotor_bar`)
   * **Paderborn Electric Motor Temperature Dataset** (`electric_motor_temp`)
5. **Quality & Leakage Auditing:** Built `DatasetValidator` and `LeakageDetector` for automated anomaly/missing-value detection and run/machine/label leakage prevention.
6. **Task-Oriented Views:** Built `TaskViewExtractor` for multi-class classification and operational-condition-aware anomaly detection.
7. **Comprehensive Verification:** 82 passing tests across backend, ML baseline, and the new data foundation layer.
8. **Simulator Safety:** MachSight-Simulator was completely untouched (92/92 tests passing, clean working tree).

---

## 2. Architecture & Data Flow

```text
       Raw Industrial Dataset (MAT, CSV, NPZ)
                        │
                        ▼
            IndustrialDatasetAdapter
           (CWRU, MCSADC, EMT, etc.)
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
  DatasetValidator              LeakageDetector
  - NaN/Inf checks              - Run overlap checks
  - Monotonicity checks         - Label leakage checks
  - Quality reports             - Temporal inversion checks
         │                             │
         └──────────────┬──────────────┘
                        │
                        ▼
                 NormalizedRecord
                 - Dataset & Machine ID
                 - Physical Sensor Measurements
                 - Explicit Sensor Units & Metadata
                 - Operating Conditions
                 - Ground-Truth FaultState
                 - Canonical Taxonomy Path
                        │
                        ▼
                TaskViewExtractor
         ┌──────────────┴──────────────┐
         ▼                             ▼
FaultClassificationView       AnomalyDetectionView
- Matrix X, Labels y          - Nominal vs Anomalous
- Class distributions         - Operating condition aware
```

---

## 3. Data Quality & Validation Summary

### 3.1 CWRU Bearing Dataset (`cwru_bearing`)
* **Records:** 2,300 windowed samples (2,048 samples per window at 48 kHz).
* **Runs:** 10 experimental conditions (Normal, Ball 007/014/021, IR 007/014/021, OR 007/014/021).
* **Missing / Infinite Values:** 0 (clean signal features).
* **Data Quality Status:** `VALID`.

### 3.2 LIAS MCSA Broken Rotor Bar Dataset (`mcsadc_rotor_bar`)
* **Runs:** 162 experimental runs (18 runs per speed/fault configuration).
* **Sensors:** 8 channels ($i_{sa}, i_{sb}, i_{sc}, v_{sa}, v_{sb}, v_{sc}, \omega, \theta$).
* **Sampling Rate:** 1,428.57 Hz ($\Delta t = 0.0007$ s).
* **Unit Normalization:** Verified conversion of rotor speed from rad/s to RPM.
* **Missing / Infinite Values:** 0 across all runs.
* **Data Quality Status:** `VALID`.

### 3.3 Paderborn Electric Motor Temperature Dataset (`electric_motor_temp`)
* **Profiles:** 69 dynamic WLTP/FTP dynamometer driving profiles.
* **Sensors:** 12 channels (d/q voltages, d/q currents, 6 temperatures, speed, torque).
* **Sampling Rate:** 2.0 Hz.
* **Missing / Infinite Values:** 0.
* **Data Quality Status:** `VALID`.

---

## 4. Test Results

### 4.1 MachSight Test Suite
```text
======================== 82 passed, 1 warning in 16.30s ========================
- backend/test_backend.py: 5 passed
- backend/test_phase1.py: 38 passed
- models/ml/test_detector.py: 8 passed
- models/ml/test_features_classification.py: 12 passed
- models/ml/test_reasoner.py: 9 passed
- data_foundation/tests/test_data_foundation.py: 10 passed
```

### 4.2 MachSight-Simulator Impact
* **MachSight-Simulator modified:** `NO`
* **Simulator Test Status:** 92 passed, 1 warning in 0.89s
