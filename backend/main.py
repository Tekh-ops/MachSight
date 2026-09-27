import sys
from pathlib import Path

# Add sibling models/ folder to sys.path before any other imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "models"))

from ml.detector import score_reading
from ml.reference_builder import load_reference_set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import db

# Load baseline reference set at startup
ref_path = Path(__file__).resolve().parent.parent / "models" / "ml" / "reference.pkl"
if not ref_path.exists():
    ref_path = Path("../models/ml/reference.pkl")
REFERENCE = load_reference_set(str(ref_path))

app = FastAPI(title="industrialdoctor-backend")

# Active WebSocket connections for telemetry broadcasting
active_connections: list[WebSocket] = []


async def broadcast(event_type: str, data: dict):
    """Broadcasts an event message to all connected WebSocket clients."""
    message = {
        "type": event_type,
        "event": event_type,
        "data": data,
        **data,
    }
    for connection in list(active_connections):
        try:
            await connection.send_json(message)
        except Exception:
            if connection in active_connections:
                active_connections.remove(connection)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time telemetry streaming."""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.websocket("/telemetry/ingest")
async def telemetry_ingest_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            reading = await websocket.receive_json()

            # Insert raw reading into raw_telemetry
            raw_id = db.insert(
                "raw_telemetry",
                {
                    "timestamp": reading.get("timestamp"),
                    "car_id": reading.get("car_id"),
                    "distance_cm": reading.get("distance_cm"),
                    "current_a": reading.get("current_a"),
                    "rpm": reading.get("rpm"),
                    "pwm_command": reading.get("pwm_command"),
                    "mode": reading.get("mode"),
                },
            )

            # Score reading against the conditioned reference baseline
            result = score_reading(reading, REFERENCE)

            # Build processed dict
            processed = {
                "current_rpm_ratio": reading["current_a"] / max(reading["rpm"], 1),
                "current_zscore": result["features"]["current_a"]["z_score"],
                "rpm_zscore": result["features"]["rpm"]["z_score"],
                "mahalanobis_distance": result["anomaly_score"],
            }

            # Insert into processed_telemetry with the raw_id foreign key
            processed_row = {
                "raw_id": raw_id,
                "timestamp": reading.get("timestamp"),
                **processed,
            }
            processed_id = db.insert("processed_telemetry", processed_row)

            # Broadcast event type "processed"
            await broadcast("processed", {**processed_row, "id": processed_id})

            # If result is an anomaly, print to console for now
            if result["is_anomaly"] is True:
                print(f"[ANOMALY DETECTED] {result}")
    except WebSocketDisconnect:
        pass
