# industrialdoctor-backend

FastAPI backend service and telemetry database for the MachSight real-time RC car monitoring and AI diagnosis system.

## Running the backend

1. Activate the venv and install deps:
```bash
cd backend
pip install -r requirements.txt
```

2. Start the server:
```bash
uvicorn main:app --reload
```
Runs on `http://127.0.0.1:8000`.

3. Send test telemetry (in a separate terminal, from `backend/`):
```bash
python ../scripts/send_test.py     # healthy reading, no investigation expected
python ../scripts/send_anomaly.py  # anomalous reading, triggers investigation after 3 consecutive samples
```

---

## WebSocket Endpoints

### `/telemetry/ingest` (Input — telemetry source sends data here)
Send JSON matching:
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

### `/ws` (Output — **dashboard connects here**)
Connect at: `ws://localhost:8000/ws`

Every message has this wrapper shape — payload fields are available both nested under `data` and duplicated at the top level:
```json
{
  "type": "<event_type>",
  "event": "<event_type>",
  "data": { ...payload... },
  ...payload fields also repeated here at the top level...
}
```

Three event types (`type`/`event`):

#### 1. `processed`
Sent after every raw reading is evaluated via `pipeline.analyze()`. `data` is a plain object:
```json
{
  "raw_id": 42,
  "timestamp": 1790529918.0,
  "current_rpm_ratio": 0.3,
  "current_zscore": 56.49,
  "rpm_zscore": -32.78,
  "mahalanobis_distance": 12.4,
  "distance_plausible": 1,
  "bucket_used": "forward:200",
  "is_anomaly": 1,
  "id": 17
}
```

#### 2. `investigation_step`
Sent on each reasoning hop during an investigation.
⚠️ `data.payload` (and top-level `payload`) is a **JSON string** — parse it to get the inner fields:
```json
{
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530086.0,
  "step_type": "reasoning",
  "payload": "{\"action\": \"request_more_data\", \"reasoning\": \"Current/RPM ratio is elevated but window data is needed.\", \"diagnosis\": null, \"confidence\": null, \"evidence_used\": [\"current_z: +56.49\"], \"recommended_action\": null, \"more_data\": {\"seconds\": 2, \"focus\": \"current\"}, \"severity\": \"warning\", \"ui_hints\": {\"highlight_metrics\": [\"current_a\", \"rpm\"], \"suggested_charts\": [\"current_timeline\"]}}"
}
```
After `JSON.parse(data.payload)`:
```json
{
  "action": "request_more_data",
  "reasoning": "Current/RPM ratio is elevated but window data is needed to confirm friction vs spike.",
  "diagnosis": null,
  "confidence": null,
  "evidence_used": ["current_z: +56.49"],
  "recommended_action": null,
  "more_data": {"seconds": 2, "focus": "current"},
  "severity": "warning",
  "ui_hints": {
    "highlight_metrics": ["current_a", "rpm"],
    "suggested_charts": ["current_timeline"]
  }
}
```

#### 3. `diagnosis`
Progressive diagnostic results emitted across two distinct stages:
1. `stage: "preliminary"`: Emitted immediately (< 2ms) upon investigation trigger directly from top-ranked statistical rule classification with real match confidence. Allows instant dashboard rendering.
2. `stage: "final"`: Emitted once autonomous local LLM reasoning completes (or deterministically resolves upon timeout/fallback).

**Preliminary Diagnosis (Instantaneous):**
```json
{
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530086.1,
  "step_type": "diagnosis",
  "payload": "{\"action\": \"diagnose\", \"reasoning\": \"[Preliminary Match] Top rule classification identified 'mechanical_drag' with confidence 0.95.\", \"diagnosis\": \"Mechanical drag / drivetrain friction resistance\", \"confidence\": 0.95, \"evidence_used\": [\"Ratio 126% above baseline\"], \"recommended_action\": \"Inspect wheel bearings, axle alignment, and lubricate drivetrain components.\", \"more_data\": null, \"severity\": \"warning\", \"ui_hints\": {\"highlight_metrics\": [\"current_rpm_ratio\", \"current_a\", \"rpm\"], \"suggested_charts\": [\"current_rpm_ratio_timeline\", \"current_timeline\"]}, \"stage\": \"preliminary\"}"
}
```

**Final Resolved Diagnosis (Refined):**
```json
{
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530088.2,
  "step_type": "diagnosis",
  "payload": "{\"action\": \"diagnose\", \"reasoning\": \"Extreme stall current combined with zero RPM confirms drivetrain jam.\", \"diagnosis\": \"Mechanical obstruction / drivetrain jam\", \"confidence\": 0.95, \"evidence_used\": [\"current_a: 6.0A (z=+56.49)\", \"rpm: 20.0 (z=-32.78)\", \"distance_cm: 85.0cm\"], \"recommended_action\": \"Cut motor PWM command immediately; clear drivetrain and check gear mesh.\", \"more_data\": null, \"severity\": \"critical\", \"ui_hints\": {\"highlight_metrics\": [\"current_a\", \"rpm\"], \"suggested_charts\": [\"current_timeline\", \"rpm_timeline\"]}, \"stage\": \"final\"}"
}
```
After `JSON.parse(data.payload)`:
```json
{
  "action": "diagnose",
  "reasoning": "Extreme stall current combined with zero RPM confirms drivetrain jam.",
  "diagnosis": "Mechanical obstruction / drivetrain jam",
  "confidence": 0.95,
  "evidence_used": ["current_a: 6.0A (z=+56.49)", "rpm: 20.0 (z=-32.78)", "distance_cm: 85.0cm"],
  "recommended_action": "Cut motor PWM command immediately; clear drivetrain and check gear mesh.",
  "more_data": null,
  "severity": "critical",
  "ui_hints": {
    "highlight_metrics": ["current_a", "rpm"],
    "suggested_charts": ["current_timeline", "rpm_timeline"]
  },
  "stage": "final"
}
```

**Inconclusive Diagnosis (Low Rule Match < 0.50):**
Includes both the backward-compatible flattened keys AND the structured `payload` JSON string:
```json
{
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530090.5,
  "step_type": "diagnosis",
  "diagnosis": "inconclusive",
  "reason": "max investigation depth reached with low rule confidence (<0.50)",
  "payload": "{\"action\": \"diagnose\", \"reasoning\": \"Investigation inconclusive: max investigation depth reached with low rule confidence (<0.50).\", \"diagnosis\": \"inconclusive\", \"confidence\": 0.0, \"evidence_used\": [], \"recommended_action\": \"Manual technician inspection recommended.\", \"more_data\": null, \"severity\": \"warning\", \"ui_hints\": {\"highlight_metrics\": [\"current_a\", \"rpm\", \"distance_cm\"], \"suggested_charts\": [\"telemetry_overview\"]}, \"reason\": \"max investigation depth reached with low rule confidence (<0.50)\", \"stage\": \"final\"}"
}
```

---

## REST Endpoints for Dashboard

### `GET /api/telemetry`
Returns historical raw and processed telemetry joined from SQLite.
- **Parameters:**
  - `since` (float, optional): Epoch timestamp cutoff
  - `limit` (int, default: 100): Maximum rows to return (1-1000)
  - `downsample` (int, default: 1): Downsample stride (e.g. 2 = every 2nd reading)

### `GET /api/investigations`
Returns recent investigations with trace IDs, start/completion timestamps, step counts, and final diagnosis payloads.
- **Parameters:**
  - `limit` (int, default: 50): Maximum traces to return (1-200)

### `GET /api/investigations/{trace_id}`
Returns all chronological reasoning steps and verdicts for a specific investigation trace.

### `GET /api/status`
Returns service status, LLM reachability, active model, fallback status, active investigation state, and database row counts:
```json
{
  "status": "ok",
  "llm_reachable": true,
  "active_model": "qwen2.5:7b-instruct",
  "fallback_active": false,
  "is_investigating": false,
  "cooldown_active": false,
  "cooldown_remaining_seconds": 0.0,
  "consecutive_anomalies": 0,
  "rolling_buffer_size": 142,
  "db_row_counts": {
    "raw_telemetry": 1240,
    "processed_telemetry": 1240,
    "investigations": 18
  }
}
```

---

## Database Schema (SQLite, `telemetry.db`)

- **`raw_telemetry`**: `id, timestamp, car_id, distance_cm, current_a, rpm, pwm_command, mode`
- **`processed_telemetry`**: `id, raw_id (FK), timestamp, current_rpm_ratio, current_zscore, rpm_zscore, mahalanobis_distance, distance_plausible, bucket_used, is_anomaly`
- **`investigations`**: `id, trace_id, timestamp, step_type ('reasoning'|'diagnosis'), payload (JSON string)`

---

## Scripts

### `scripts/mock_car.py` — RC car telemetry simulator
Streams physically-plausible JSON readings to `/telemetry/ingest` at a configurable rate.
The car starts healthy, then transitions to the requested fault after `--start-fault-after` seconds.

**Fault signatures (calibrated against `reference.pkl` forward:200 baseline)**:
| Fault | Signature |
|---|---|
| `drag` | Current +55% above baseline, RPM −32%; sustained, non-zero RPM |
| `jam` | Stall current 5–7 A, RPM < 10, distance stays clear (≥ 45 cm, internal not wall) |
| `sensor_fault` | Distance sensor freezes at one value OR emits < 2 cm / > 400 cm |

```bash
# Healthy baseline for 10 seconds
python scripts/mock_car.py --fault none --duration 10

# 5 s healthy then drag fault for 25 s, 10 Hz
python scripts/mock_car.py --fault drag --duration 30 --start-fault-after 5

# Jam fault (immediate)
python scripts/mock_car.py --fault jam --duration 20 --start-fault-after 3

# Sensor fault at 5 Hz, verbose
python scripts/mock_car.py --fault sensor_fault --rate 5 --verbose

# All flags
#   --fault none|drag|jam|sensor_fault  --duration SEC  --rate HZ
#   --start-fault-after SEC  --pwm 0-255  --mode forward|idle|...
#   --car-id STR  --seed INT  --host HOST  --port PORT  --verbose
```

### `scripts/replay.py` — Trace replayer
Replays a stored SQLite DB or CSV file into the backend at original timing.

```bash
# Replay healthy CSV at 4× speed
python scripts/replay.py --source models/ml/healthy_telemetry.csv --speed 4

# Replay stored DB at real speed
python scripts/replay.py --source backend/telemetry.db --speed 1

# Flags: --source PATH  --speed FLOAT  --limit INT  --car-id STR  --host HOST  --port PORT  --verbose
```

### `scripts/run_demo.sh` — Demo launcher
Preflight-checks Python, dependencies, `reference.pkl`, and Ollama; starts the backend; prints the full demo command sequence.

```bash
bash scripts/run_demo.sh                          # full checks + start + guide
bash scripts/run_demo.sh --skip-ollama-check      # skip Ollama check (stub mode)
bash scripts/run_demo.sh --model qwen2.5:3b-instruct
```

Environment overrides: `MACHSIGHT_HOST`, `MACHSIGHT_PORT`, `OLLAMA_URL`, `MACHSIGHT_LLM_MODEL`, `VENV_DIR`.

### `scripts/e2e_timing.py` — Real Ollama end-to-end timing
Runs a drag-fault stream against a live backend and Ollama instance and reports:
- Fault onset → first anomaly alert latency
- Anomaly → investigation start latency
- Investigation → final diagnosis latency (LLM reasoning time)

```bash
# Ensure backend is running, then:
MACHSIGHT_LLM_MODEL=qwen2.5:3b-instruct python scripts/e2e_timing.py

# Flags: --host HOST  --port PORT  --model MODEL_NAME
```

### `scripts/test_e2e_mock_car.py` — End-to-end pytest (LLM mocked)
Runs the full pipeline (mock_car → analyze → trigger_investigation) with a deterministic mock LLM.
Verifies that each fault mode produces the correct diagnosis type.

```bash
pytest scripts/test_e2e_mock_car.py -v
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MACHSIGHT_LLM_MODEL` | `qwen2.5:7b-instruct` | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `MACHSIGHT_USE_STUB` | `0` | Set to `1` to force rule-based stub (no LLM) |
| `MACHSIGHT_CONSECUTIVE_ANOMALIES` | `3` | Anomaly count before investigation triggers |
| `MACHSIGHT_INVESTIGATION_COOLDOWN` | `15.0` | Seconds between investigations |

