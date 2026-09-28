# MachSight System Architecture & Context Documentation (Step 0)

## Overview
**MachSight** is an AI-powered diagnostic system for an RC car instrumented with three primary sensors:
- Ultrasonic distance (`distance_cm`)
- Motor current draw (`current_a`)
- Wheel rotation speed (`rpm`)
- Plus operational context: PWM command (`pwm_command`: 0–255) and operating mode (`mode`: `idle` | `forward` | `turning_left` | `turning_right` | `braking`).

The end-to-end data pipeline:
`Hardware / Mock Stream` $\rightarrow$ `FastAPI Ingestion WebSocket (/telemetry/ingest)` $\rightarrow$ `SQLite (telemetry.db: raw_telemetry)` $\rightarrow$ `Preprocessing & Conditioning` $\rightarrow$ `Statistical Anomaly Detection (Mahalanobis / z-score)` $\rightarrow$ `Autonomous Reasoning Loop (Ollama qwen2.5:7b-instruct)` $\rightarrow$ `Dashboard WebSocket (/ws)`.

---

## 1. Database Schema (`backend/telemetry.db`)
Database connection and schema definitions are maintained in `backend/db.py`. Initialized automatically on startup via `init_db()`.

### Tables and Columns

#### 1. `raw_telemetry`
Stores unmodified sensor readings received from the RC vehicle or mock stream.
| Column | Type | Constraints / Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | Primary Key, Autoincrement |
| `timestamp` | `REAL` | Epoch timestamp (seconds); nullable if omitted by sender |
| `car_id` | `TEXT` | Vehicle identifier (e.g., `'car-01'`) |
| `distance_cm` | `REAL` | Ultrasonic range sensor measurement (2.0 to 400.0 cm) |
| `current_a` | `REAL` | Motor current draw in Amperes |
| `rpm` | `REAL` | Wheel rotation speed in RPM |
| `pwm_command` | `INTEGER` | Commanded Pulse Width Modulation value (0–255) |
| `mode` | `TEXT` | Operating mode (`'idle'`, `'forward'`, `'turning_left'`, `'turning_right'`, `'braking'`) |

#### 2. `processed_telemetry`
Stores derived features and statistical anomaly indicators calculated for each reading.
| Column | Type | Constraints / Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | Primary Key, Autoincrement |
| `raw_id` | `INTEGER` | Foreign Key referencing `raw_telemetry(id)` |
| `timestamp` | `REAL` | Epoch timestamp matched to raw reading |
| `current_rpm_ratio` | `REAL` | Ratio: `current_a / max(rpm, 1)` |
| `current_zscore` | `REAL` | Standard deviations from baseline current for `(mode, pwm)` |
| `rpm_zscore` | `REAL` | Standard deviations from baseline RPM for `(mode, pwm)` |
| `mahalanobis_distance` | `REAL` | Multivariate statistical anomaly distance metric |

#### 3. `investigations`
Logs each step and final diagnostic outcome of autonomous multi-hop reasoning investigations.
| Column | Type | Constraints / Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | Primary Key, Autoincrement |
| `trace_id` | `TEXT` | UUID v4 string grouping all steps of a single investigation session |
| `timestamp` | `REAL` | Epoch timestamp when the reasoning step/outcome occurred |
| `step_type` | `TEXT` | `'reasoning'` for intermediate hops; `'diagnosis'` for terminal verdicts |
| `payload` | `TEXT` | JSON-serialized string of the reasoner result dict |

*Note on current implementation:* The terminal `'inconclusive'` event generated when reaching `MAX_LOOPS` is currently broadcast over WebSocket but is **not** written to the `investigations` table in `backend/main.py`.

---

## 2. WebSocket Endpoints, Event Types & Envelopes

### 2.1 Telemetry Ingestion Endpoint: `ws://localhost:8000/telemetry/ingest`
- **Role:** High-frequency stream input from vehicle or mock script.
- **Protocol:** Incoming messages are JSON objects containing raw telemetry.
- **Input Example:**
```json
{
  "car_id": "car-01",
  "distance_cm": 85.0,
  "current_a": 6.0,
  "rpm": 20.0,
  "pwm_command": 200,
  "mode": "forward"
}
```

### 2.2 Client Broadcasting Endpoint: `ws://localhost:8000/ws`
- **Role:** Dashboard broadcast stream.
- **Envelope Structure:** All messages sent through `broadcast(event_type: str, data: dict)` are structured with fields mirrored under `data` and at the top level:
```json
{
  "type": "<event_type>",
  "event": "<event_type>",
  "data": { ...payload_fields... },
  ...payload_fields (duplicated at top level)...
}
```

### 2.3 Event Types & Real Payloads

#### Event 1: `processed`
Sent immediately after a reading is ingested, stored, and evaluated by `score_reading()`.
```json
{
  "type": "processed",
  "event": "processed",
  "data": {
    "raw_id": 42,
    "timestamp": 1790529918.0,
    "current_rpm_ratio": 0.3,
    "current_zscore": 56.49,
    "rpm_zscore": -32.78,
    "mahalanobis_distance": 12.4,
    "id": 17
  },
  "raw_id": 42,
  "timestamp": 1790529918.0,
  "current_rpm_ratio": 0.3,
  "current_zscore": 56.49,
  "rpm_zscore": -32.78,
  "mahalanobis_distance": 12.4,
  "id": 17
}
```

#### Event 2: `investigation_step`
Sent on each reasoning hop within `trigger_investigation()`.
**Important:** `data.payload` (and the top-level `payload`) is a **double-encoded JSON string**. Clients must parse `data.payload` (e.g. `JSON.parse(data.payload)`) to access the inner fields.
```json
{
  "type": "investigation_step",
  "event": "investigation_step",
  "data": {
    "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
    "timestamp": 1790530086.0,
    "step_type": "reasoning",
    "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"Motor current (6.00A) is 242.9% above baseline mean (1.75A) for mode 'forward' (z-score: +53.12).\", \"confidence\": 0.5}"
  },
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530086.0,
  "step_type": "reasoning",
  "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"Motor current (6.00A) is 242.9% above baseline mean (1.75A) for mode 'forward' (z-score: +53.12).\", \"confidence\": 0.5}"
}
```
*Parsed inner payload:*
```json
{
  "action": "diagnose",
  "diagnosis": "Motor current (6.00A) is 242.9% above baseline mean (1.75A) for mode 'forward' (z-score: +53.12).",
  "confidence": 0.5
}
```

#### Event 3: `diagnosis` (Terminal Resolution)
Produced when `reasoning_result.get("action") == "diagnose"`.
Shape matches `investigation_step`, with `step_type: "diagnosis"`.
```json
{
  "type": "diagnosis",
  "event": "diagnosis",
  "data": {
    "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
    "timestamp": 1790530086.1,
    "step_type": "diagnosis",
    "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"Mechanical jam: high stall current with zero wheel RPM\", \"confidence\": 0.95}"
  },
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530086.1,
  "step_type": "diagnosis",
  "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"Mechanical jam: high stall current with zero wheel RPM\", \"confidence\": 0.95}"
}
```

#### Event 4: `diagnosis` (Inconclusive - Current Backend Implementation)
Produced if `MAX_LOOPS` (3) is reached without diagnosis.
**Current state in `main.py`:**
```json
{
  "type": "diagnosis",
  "event": "diagnosis",
  "data": {
    "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
    "diagnosis": "inconclusive",
    "reason": "max investigation depth reached"
  },
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "diagnosis": "inconclusive",
  "reason": "max investigation depth reached"
}
```
*Allowed Fix:* Harmonize with normal diagnosis by supplying a JSON string `payload` and `step_type: "diagnosis"`:
```json
{
  "type": "diagnosis",
  "event": "diagnosis",
  "data": {
    "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
    "timestamp": 1790530086.2,
    "step_type": "diagnosis",
    "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"inconclusive\", \"reason\": \"max investigation depth reached\", \"confidence\": 0.0}"
  },
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530086.2,
  "step_type": "diagnosis",
  "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"inconclusive\", \"reason\": \"max investigation depth reached\", \"confidence\": 0.0}"
}
```

### 2.4 Frontend Expectation vs. Reality
- In `backend/README.md`, frontend clients are directed to connect to `ws://localhost:8000/ws` and consume `processed`, `investigation_step`, and `diagnosis`.
- In `frontend/IndustrialDoctor.tsx`, the frontend is currently an isolated mockup configured to point to `ws://scada-broker.lan:8080/v1/telemetry`. It simulates generic factory machinery (turbines, extruders, pumps) using a browser `setInterval` timer, expecting fields like `bearingTemp`, `vibrationRms`, and `hydraulicPressure`. No live WebSocket client connects to `ws://localhost:8000/ws`.

---

## 3. Reasoner Contract & Investigation Flow (`ml_stub.py` and `main.py`)

### 3.1 `ml_stub.py` Contract
Function signature:
```python
def reason(evidence: dict, history: list) -> dict:
```
- **Inputs:**
  - `evidence` (dict): Merged state from `reading`, `processed`, and detector `result`:
    - `car_id`, `distance_cm`, `current_a`, `rpm`, `pwm_command`, `mode`, `timestamp`
    - `current_rpm_ratio`, `current_zscore`, `rpm_zscore`, `mahalanobis_distance`
    - `reasons`: list of detector explanation strings (`result["reasons"]`)
    - `anomaly_score`: Mahalanobis distance or combined z-score (`result["anomaly_score"]`)
  - `history` (list): Chronological list of previously returned `reasoning_result` dictionaries accumulated across loop iterations when `action == "request_more_data"`. Initially `[]`.
- **Output:**
  Dictionary containing:
  - `"action"`: `"diagnose"` | `"request_more_data"`
  - If `"action" == "diagnose"`: must include `"diagnosis"` (str) and `"confidence"` (float, 0.0–1.0).
  - Extra keys (e.g., `"request_query"`, `"reason"`) are permitted.

### 3.2 Ingestion & Autonomous Investigation Sequence in `main.py`
```
[Client / Script]
       |
       |  JSON {car_id, current_a, rpm, distance_cm, pwm_command, mode}
       v
@app.websocket("/telemetry/ingest")
       |
       |--> db.insert("raw_telemetry", reading)
       |
       |--> score_reading(reading, REFERENCE)
       |
       |--> Compute processed features:
       |      - current_rpm_ratio = current_a / max(rpm, 1)
       |      - current_zscore = result["features"]["current_a"]["z_score"]
       |      - rpm_zscore = result["features"]["rpm"]["z_score"]
       |      - mahalanobis_distance = result["anomaly_score"]
       |
       |--> db.insert("processed_telemetry", processed_row)
       |
       |--> broadcast("processed", processed_row)
       |
       +--> if result["is_anomaly"] is True:
              |
              v
       trigger_investigation(reading, processed, result)
              |
              |-- trace_id = uuid4()
              |-- evidence = {**reading, **processed, reasons, anomaly_score}
              |-- history = []
              |-- Loop up to MAX_LOOPS (3):
              |     |
              |     |-- reasoning_result = ml_stub.reason(evidence, history)
              |     |-- db.insert("investigations", {step_type: "reasoning", payload})
              |     |-- broadcast("investigation_step", ...)
              |     |
              |     +-- if action == "diagnose":
              |     |     db.insert("investigations", {step_type: "diagnosis", payload})
              |     |     broadcast("diagnosis", ...)
              |     |     return
              |     |
              |     +-- if action == "request_more_data":
              |           history.append(reasoning_result)
              |           continue (currently does NOT collect new data!)
              |
              +-- Loop exhausted:
                    broadcast("diagnosis", {diagnosis: "inconclusive", reason: "max investigation depth reached"})
```

---

## 4. ML Anomaly Detection Layer (`models/ml/`)

### 4.1 Reference Builder (`reference_builder.py`)
- **Purpose:** Constructs baseline distributions from healthy RC car telemetry without external machine learning models or training frameworks.
- **Function:** `build_reference_set(csv_path: str) -> Dict[str, Any]`
  - Groups samples by operating condition bucket: `(mode, pwm_command)`.
  - Computes empirical mean vector $\mu = [\text{current\_a\_mean}, \text{rpm\_mean}]$ and $2 \times 2$ covariance matrix $\Sigma$.
  - Regularizes covariance matrix ($\Sigma_{\text{reg}} = \Sigma + 10^{-6} \cdot I$) to prevent singularity (especially in `idle` mode where variance is minimal).
  - Computes matrix inverse $\Sigma_{\text{reg}}^{-1}$ via `scipy.linalg.inv()`.
  - If a bucket has fewer than 20 samples (`MIN_SAMPLES_FOR_MAHALANOBIS = 20`) or is singular, flags `use_zscore_fallback = True`.
- **Output Reference Dictionary Structure:**
```python
{
  "buckets": {
    "forward:200": {
      "mode": "forward",
      "pwm_command": 200,
      "sample_count": 60,
      "mean_vector": [1.75, 305.0],
      "covariance_matrix": [[0.0064, 0.0], [0.0, 64.0]],
      "inv_covariance_matrix": [[156.25, 0.0], [0.0, 0.0156]],
      "current_mean": 1.75,
      "current_std": 0.08,
      "rpm_mean": 305.0,
      "rpm_std": 8.0,
      "use_zscore_fallback": False
    },
    ...
  },
  "mode_pwms": {
    "idle": [0],
    "forward": [100, 150, 200],
    "turning_left": [100, 150, 200],
    "turning_right": [100, 150, 200],
    "braking": [0, 50]
  },
  "total_samples": 600
}
```
- **Serialization:** `save_reference_set(reference, path)` and `load_reference_set(path)` serialize/deserialize via Python `pickle` (`reference.pkl`).

### 4.2 Detector (`detector.py`)
- **Function:** `score_reading(reading: Dict[str, Any], reference: Dict[str, Any], threshold: float = 3.0) -> Dict[str, Any]`
- **Step 1: Bucket Matching & Fallback:**
  - Looks up exact `mode:pwm_command`.
  - If absent, invokes `_find_nearest_pwm_bucket(mode, pwm_command, reference)`, matching the closest PWM available for that mode (or first bucket if mode is missing), appending an explanation to `reasons`.
- **Step 2: Distance Metric:**
  - Standard Case: Mahalanobis distance:
    $$D_M(x) = \sqrt{(x - \mu)^T \Sigma^{-1} (x - \mu)}$$
  - Low Sample / Degenerate Fallback: Euclidean z-score distance:
    $$D_Z(x) = \sqrt{z_{\text{current}}^2 + z_{\text{rpm}}^2}$$
- **Step 3: Physical Plausibility Checks:**
  - Checks if `distance_cm` is within valid HC-SR04 bounds $[2.0, 400.0]\text{ cm}$ (or NaN/inf). Flags anomaly immediately if violated.
- **Step 4: Rule-based Diagnostic Explanations:**
  - Current deviation $> 15\%$ or $|z| \ge 2.0$.
  - RPM deviation $> 15\%$ or $|z| \ge 2.0$.
- **Output Schema (`DetectorOutput`):**
```python
{
  "is_anomaly": True,
  "anomaly_score": 53.12,
  "mode": "forward",
  "pwm_command": 200,
  "matched_pwm": 200,
  "reasons": [
    "Motor current (6.00A) is 242.9% above baseline mean (1.75A) for mode 'forward' (z-score: +53.12)."
  ],
  "features": {
    "current_a": {
      "value": 6.0,
      "baseline_mean": 1.75,
      "baseline_std": 0.08,
      "z_score": 53.12,
      "pct_diff": 242.9
    },
    "rpm": {
      "value": 20.0,
      "baseline_mean": 305.0,
      "baseline_std": 8.0,
      "z_score": -35.62,
      "pct_diff": -93.4
    }
  }
}
```

---

## 5. Verification of Ground Truth Facts

| # | Stated Ground Truth Fact | Verification Status | Codebase Reality & Observations |
| :--- | :--- | :--- | :--- |
| 1 | `backend/main.py` already calls `score_reading()` from `models/ml/detector.py` for anomaly detection. It works. Do not replace it; build on top of it. | **CONFIRMED** | `main.py` imports `score_reading` (line 10), loads `reference.pkl` via `load_reference_set` (line 21), and calls `score_reading(reading, REFERENCE)` in the ingest route (line 133). 8 unit tests in `models/ml/test_detector.py` pass. |
| 2 | `trigger_investigation()` in `main.py` currently calls `ml_stub.reason(evidence, history)`. The only swap needed for reasoning is replacing that call with the real reasoner. Keep `trigger_investigation()`'s name and signature. Upgrade it in place. Do not create a parallel loop. | **CONFIRMED** | `trigger_investigation(reading: dict, processed: dict, result: dict)` in `backend/main.py:63` calls `ml_stub.reason(evidence, history)` on line 76 inside a 3-iteration loop. |
| 3 | `reason()` contract: `reason(evidence: dict, history: list) -> dict`. Output must contain `"action"` (`"diagnose"` \| `"request_more_data"`). A diagnose result must also contain `"diagnosis"` and `"confidence"`. Extra keys are allowed. | **CONFIRMED** | Defined in `backend/ml_stub.py:4` and consumed by `main.py:86,97`. |
| 4 | `collect_window()` is NOT implemented. The `request_more_data` branch currently only appends to history and loops without collecting anything. It must be implemented properly (Step 3). | **CONFIRMED** | Lines 97–99 in `main.py` simply do: `history.append(reasoning_result)` followed by `continue`. No buffering, querying, or window collection exists. |
| 5 | Frontend connects to `ws://localhost:8000/ws`. Envelope: `investigation_step` and most diagnosis events carry `data.payload` as a JSON STRING; every field is duplicated as `data.xyz` and flattened top-level `xyz`. Keep this envelope for all existing and new events. The one allowed fix: the "inconclusive" diagnosis event must also include a payload (JSON string, same shape as a normal diagnosis). | **DIFFERS / PARTIAL MISMATCH** | **Backend Envelope Confirmed:** `broadcast()` duplicates data into `data.*` and top-level `*`. `investigation_step` and normal `diagnosis` carry stringified `payload`.<br>**Inconclusive Shape Confirmed:** As noted, `inconclusive` currently lacks `step_type`, `payload` string, and DB insertion.<br>**Frontend Discrepancy:** The frontend (`IndustrialDoctor.tsx`) does **not** connect to `ws://localhost:8000/ws`. It defaults to `'ws://scada-broker.lan:8080/v1/telemetry'` and runs an internal mock generator for industrial factory plant machinery. |
| 6 | `backend/README.md` holds example JSON for `processed`, `investigation_step` and `diagnosis` events. Keep it updated whenever payloads change. | **CONFIRMED** | `backend/README.md` accurately documents the three event types and warns about the stringified `data.payload` and dual diagnosis shapes. |

---

## 6. Gap List (Backend, ML, and Frontend Discrepancies)

1. **Stubbed Reasoning Engine:**
   - `backend/ml_stub.py` returns hardcoded confidence (0.5) and a placeholder diagnosis string. Ollama (`qwen2.5:7b-instruct`) integration is not yet connected.
2. **Missing Telemetry Window Collection (`collect_window()`):**
   - When the reasoner requests additional data (`action == "request_more_data"`), the loop immediately recurses without retrieving preceding or succeeding telemetry buffers from SQLite.
3. **Inconclusive Diagnosis Shape Asymmetry:**
   - Reaching `MAX_LOOPS = 3` produces a bare JSON message `{trace_id, diagnosis: "inconclusive", reason: "..."}` rather than including `timestamp`, `step_type: "diagnosis"`, and a serialized `payload` JSON string. It also omits saving the terminal step into the `investigations` SQLite table.
4. **Missing Timestamps in Ingestion Stream:**
   - Test scripts (`send_test.py`, `send_anomaly.py`) do not pass a `timestamp` field in raw readings. `main.py` saves `None` into `raw_telemetry` and `processed_telemetry` for `timestamp`, which prevents time-ordered window queries unless falling back to auto-incrementing `id`.
5. **Frontend Domain & Connection Disconnect:**
   - The UI in `frontend/IndustrialDoctor.tsx` is completely decoupled from the backend:
     - No WebSocket client is opened to `ws://localhost:8000/ws`.
     - Displays industrial machinery metrics (bearing temperature, vibration RMS, hydraulic pressure, acoustic emission) instead of RC car metrics (`distance_cm`, `current_a`, `rpm`, `pwm_command`, `mode`).
     - Lacks parsing for `processed`, `investigation_step`, and `diagnosis` events.
6. **Backend Test Suite Absence:**
   - While `models/ml/test_detector.py` covers ML functionality, there are currently no automated unit or integration tests for `backend/main.py`, `backend/db.py`, or the WebSocket ingestion and broadcast pipelines.
7. **WebSocket Concurrency & Broadcast Safety:**
   - `active_connections` list in `main.py` is mutated during broadcasts without concurrency locks.
