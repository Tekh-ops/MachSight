# MachSight Industrial Dataset Schema Specification

This document details the architecture and data contracts of the MachSight Industrial Data Foundation Layer.

---

## 1. Architectural Separation

MachSight maintains an explicit separation between two telemetry regimes:

```text
┌──────────────────────────────────────────────┐
│       MachSight-Simulator Telemetry          │
│   Streaming contract for RC Car testbench    │
│   - distance_cm                              │
│   - current_a                                │
│   - wheel_rpm                                │
│   - timestamp                                │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│       MachSight Real-Time Ingestion          │
│   - WebSocket streaming handler              │
│   - Phase 1 Baseline & Z-score evaluation    │
│   - Phase 1 LLM diagnostic reasoner          │
└──────────────────────────────────────────────┘

                       ▲
                       │ Task View / Adaptation
┌──────────────────────────────────────────────┐
│       Industrial Data Foundation Layer       │
│   - Preserves machine-specific sensors       │
│   - Strongly-typed NormalizedRecord          │
│   - Hierarchical Fault Taxonomy              │
│   - Leakage-free split management            │
│   - Verifiable provenance & data quality     │
└──────────────────────────────────────────────┘
```

### Critical Rule
> **Industrial sensor readings MUST NOT be renamed or squeezed into RC-car streaming attributes.**
> Stator currents ($i_{sa}$), vibration acceleration ($g$), and temperatures ($^\circ\text{C}$) are distinct physical quantities with distinct sampling frequencies and units. They are preserved intact in `NormalizedRecord`.

---

## 2. Core Data Contracts

### 2.1 `NormalizedRecord`

```python
@dataclass
class NormalizedRecord:
    dataset_id: str                          # e.g., "cwru_bearing"
    machine_id: str                          # e.g., "reliance_motor_cwru_01"
    run_id: str                              # e.g., "run_IR014_1_175"
    timestamp_s: float                       # continuous physical seconds
    operating_conditions: Dict[str, Any]     # e.g., {"motor_load_hp": 1.0, "rpm": 1772}
    sensor_readings: Dict[str, float]        # machine-specific physical measurements
    sensor_metadata: Dict[str, SensorMeta]   # units, physical quantity, transducer type
    fault_state: FaultState                  # is_anomaly, fault_type, severity, component
    original_label: Optional[str]            # raw label from source file (e.g., "IR_014_1")
    normalized_label: Optional[str]          # normalized concept (e.g., "bearing_inner_race_014")
    taxonomy_path: Optional[str]             # canonical taxonomy path (e.g., "mechanical.bearing.inner_race")
    provenance: Dict[str, Any]               # source file, sampling rate, window parameters
```

### 2.2 `SensorMeta`

Describes physical sensor characteristics without guessing:

```python
@dataclass(frozen=True)
class SensorMeta:
    name: str
    physical_quantity: str      # e.g., "vibration_acceleration", "stator_current"
    unit: str                   # e.g., "g", "A", "V", "degC", "RPM", "rad/s"
    sampling_rate_hz: Optional[float]
    location: Optional[str]     # e.g., "drive_end", "phase_a", "cooling_jacket"
    sensor_type: Optional[str]  # e.g., "accelerometer", "hall_effect", "thermocouple"
    description: Optional[str]
```

### 2.3 `FaultState`

Structured ground-truth representation for anomaly detection and diagnostic validation:

```python
@dataclass(frozen=True)
class FaultState:
    is_anomaly: bool
    fault_type: Optional[str]   # e.g., "bearing_inner_race_014", "broken_rotor_bar_1"
    severity: Optional[float]   # e.g., 0.014 (inches) or 1.0 (single broken bar)
    component: Optional[str]    # e.g., "bearing", "rotor", "permanent_magnet"
    description: Optional[str]
```

---

## 3. Hierarchical Fault Taxonomy

The `FaultTaxonomy` tree structure maps dataset-specific labels into standardized diagnostic concepts:

```text
fault
├── healthy
│   └── healthy.baseline
│
├── mechanical
│   ├── bearing
│   │   ├── inner_race
│   │   ├── outer_race
│   │   └── ball
│   ├── gear
│   │   └── wear
│   ├── shaft
│   │   └── misalignment
│   ├── drag
│   └── jam
│
├── electrical
│   ├── rotor
│   │   ├── broken_bar
│   │   ├── broken_bar_1
│   │   └── broken_bar_2
│   ├── stator
│   │   └── winding_short
│   └── current_unbalance
│
├── thermal
│   ├── permanent_magnet
│   │   └── overheating
│   ├── stator
│   │   └── winding_overheating
│   └── coolant
│       └── insufficient
│
└── sensor
    ├── ultrasonic
    │   ├── out_of_range
    │   └── dropout
    ├── rpm
    │   └── dropout
    └── current
        └── saturation
```

Every node preserves:
* **Suspected physical component** (e.g. `bearing`, `rotor`, `stator_winding`, `ultrasonic_sensor`).
* **Physical system** (e.g. `drive_train`, `electromagnetic`, `thermal_management`, `sensor_array`).
* **Textual description** for deterministic diagnostic context.
