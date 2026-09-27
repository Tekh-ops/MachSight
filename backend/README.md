# industrialdoctor-backend

FastAPI backend service and telemetry database for the IndustrialDoctor real-time monitoring system.



## Running the backend

1. Activate the venv and install deps:

cd backend
pip install -r requirements.txt

2. Start the server:

uvicorn main:app --reload

   Runs on `http://127.0.0.1:8000`.

3. Send test telemetry (in a separate terminal, from `backend/`):

python ..\scripts\send_test.py # healthy reading, no investigation expected
python ..\scripts\send_anomaly.py # anomalous reading, triggers investigation


## WebSocket endpoints

### `/telemetry/ingest` (input — telemetry source sends data here)
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

### `/ws` (output — **dashboard connects here**, not `/telemetry/live`)
Connect at: `ws://localhost:8000/ws`

> Note: the original plan called this `/telemetry/live`. The actual route is `/ws`. Connect to `/ws`.

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

**`processed`** — sent after every raw reading is scored. `data` is a plain object:
```json
{
  "raw_id": 42,
  "timestamp": 1790529918.0,
  "current_rpm_ratio": 0.3,
  "current_zscore": 56.49,
  "rpm_zscore": -32.78,
  "mahalanobis_distance": 12.4,
  "id": 17
}
```

**`investigation_step`** — sent on each reasoning hop during an investigation. ⚠️ `data.payload` is a **JSON string**, not an object — parse it again to get the real fields:
```json
{
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "timestamp": 1790530086.0,
  "step_type": "reasoning",
  "payload": "{\"action\": \"diagnose\", \"diagnosis\": \"...\", \"confidence\": 0.5}"
}
```
After `JSON.parse(data.payload)`, you get:
```json
{ "action": "diagnose", "diagnosis": "...", "confidence": 0.5 }
```

**`diagnosis`** — final result of an investigation. Has **two different shapes** depending on how it ended:

- Normal diagnosis (same shape as `investigation_step` above, `step_type: "diagnosis"`, `data.payload` is a JSON string — parse it the same way).
- Inconclusive (max investigation depth reached) — **flat, no `payload` field at all**:
```json
{
  "trace_id": "b4990b22-92b3-44cd-9732-e5074495e53e",
  "diagnosis": "inconclusive",
  "reason": "max investigation depth reached"
}
```

⚠️ **When handling a `diagnosis` event, always check `if (data.payload)` before parsing** — the inconclusive case has no `payload` key and will throw if you assume it exists.

## Database schema (SQLite, `telemetry.db`)

- **raw_telemetry**: `id, timestamp, car_id, distance_cm, current_a, rpm, pwm_command, mode`
- **processed_telemetry**: `id, raw_id (FK), timestamp, current_rpm_ratio, current_zscore, rpm_zscore, mahalanobis_distance`
- **investigations**: `id, trace_id, timestamp, step_type ('reasoning'|'diagnosis'), payload (JSON string, absent on inconclusive diagnosis)`

## Known limitations (as of this commit)

- `trigger_investigation()`'s reasoning step still calls `ml_stub.reason()`, not the real ML teammate's reasoning module — confidence is always `0.5` and diagnosis text is placeholder wording. The anomaly *detection* (`score_reading`) is real; the *reasoning/diagnosis* text is not yet.

