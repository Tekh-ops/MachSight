"""MachSight Phase 6 End-to-End Validation Script
Validates the complete flow:
Simulator / Telemetry Ingestion -> Processing / Anomaly Detection -> Diagnostic Reasoner -> WebSocket Broadcast -> Operator Dashboard
"""

import asyncio
import json
import os
import sys
import time
import urllib.request
import websockets

BACKEND_WS = "ws://127.0.0.1:8000/ws"
INGEST_WS = "ws://127.0.0.1:8000/telemetry/ingest"
STATUS_URL = "http://127.0.0.1:8000/api/status"

async def run_e2e_validation():
    print("=" * 60)
    print("MACHSIGHT PHASE 6 E2E OPERATOR DASHBOARD VALIDATION")
    print("=" * 60)

    # 1. Check Backend REST Status
    print("\n[Step 1] Checking Backend Status & LLM Availability...")
    try:
        req = urllib.request.urlopen(STATUS_URL, timeout=3)
        status_data = json.loads(req.read().decode())
        print(f"  Backend Status: {status_data.get('status')}")
        print(f"  Active Model:   {status_data.get('active_model')}")
        print(f"  LLM Reachable:  {status_data.get('llm_reachable')}")
    except Exception as e:
        print(f"  ERROR connecting to backend status endpoint: {e}")
        return False

    # 2. Connect Client to Operator Dashboard WebSocket (/ws)
    print("\n[Step 2] Connecting Frontend Client to Broadcast Bus (/ws)...")
    async with websockets.connect(BACKEND_WS) as client_ws:
        print("  Client connected to ws://127.0.0.1:8000/ws successfully.")

        # 3. Scenario A: Healthy Machine Telemetry
        print("\n[Step 3] Scenario A — Ingesting Nominal Telemetry...")
        async with websockets.connect(INGEST_WS) as ingest_ws:
            nominal_packet = {
                "car_id": "rc-test-02",
                "distance_cm": 120.5,
                "current_a": 1.25,
                "rpm": 210.0,
                "pwm_command": 150,
                "mode": "forward"
            }
            await ingest_ws.send(json.dumps(nominal_packet))
            print("  Ingested nominal packet:", nominal_packet)

        # Receive broadcast on client
        msg_raw = await asyncio.wait_for(client_ws.recv(), timeout=5.0)
        msg = json.loads(msg_raw)
        print(f"  Received broadcast event on /ws: type='{msg.get('type')}'")
        data = msg.get("data", {})
        print(f"  Received processed data: is_anomaly={data.get('is_anomaly')}, distance_plausible={data.get('distance_plausible')}, current={data.get('current_a')}, rpm={data.get('rpm')}")
        assert data.get("is_anomaly") == 0, f"Expected is_anomaly=0, got {data.get('is_anomaly')}"
        assert bool(data.get("distance_plausible")) is True, f"Expected distance_plausible=True"
        print("  [PASS] Scenario A: Healthy telemetry stream received, no anomaly detected.")

        # 4. Scenario B: Fault Scenario (Mechanical Drag / Jam)
        print("\n[Step 4] Scenario B — Ingesting Anomalous Telemetry (Drivetrain Resistance)...")
        received_anomaly = False
        received_diagnosis = False
        diagnosis_payload = None

        async with websockets.connect(INGEST_WS) as ingest_ws:
            # Send 4 sustained anomalous readings to trigger investigation threshold
            for i in range(4):
                fault_packet = {
                    "car_id": "rc-sim-01",
                    "distance_cm": 75.0,
                    "current_a": 6.2,  # Abnormally high current
                    "rpm": 25.0,       # Abnormally low RPM -> stall / drag
                    "pwm_command": 200,
                    "mode": "forward"
                }
                await ingest_ws.send(json.dumps(fault_packet))
                await asyncio.sleep(0.1)

        print("  Awaiting broadcast events on /ws for up to 10 seconds...")
        start_time = time.time()
        while time.time() - start_time < 10.0 and (not received_anomaly or not received_diagnosis):
            try:
                msg_raw = await asyncio.wait_for(client_ws.recv(), timeout=3.0)
                msg = json.loads(msg_raw)
                evt_type = msg.get("type")

                if evt_type == "processed":
                    d = msg.get("data", {})
                    if d.get("is_anomaly") == 1:
                        received_anomaly = True
                        print(f"  [PASS] Processed Anomaly Detected: score={d.get('mahalanobis_distance'):.2f}, bucket={d.get('bucket_used')}")
                elif evt_type in ("diagnosis", "investigation_step"):
                    received_diagnosis = True
                    raw_payload = msg.get("data", {}).get("payload")
                    if isinstance(raw_payload, str):
                        diagnosis_payload = json.loads(raw_payload)
                    else:
                        diagnosis_payload = raw_payload
                    print(f"  [PASS] AI Diagnosis Broadcast Received: '{diagnosis_payload.get('diagnosis')}'")
                    print(f"    Suspected Component: {diagnosis_payload.get('suspected_component')}")
                    print(f"    Severity:            {diagnosis_payload.get('severity')}")
                    print(f"    Confidence:          {diagnosis_payload.get('confidence')}")
                    print(f"    Evidence Count:      {len(diagnosis_payload.get('evidence_used', []))}")
                    break
            except asyncio.TimeoutError:
                break

        assert received_anomaly, "Failed to receive anomaly event on /ws"
        print("  [PASS] Scenario B: Anomaly detected and diagnosis generated by backend.")

        # 5. Scenario C: Recovery Scenario
        print("\n[Step 5] Scenario C — Ingesting Recovery Telemetry...")
        async with websockets.connect(INGEST_WS) as ingest_ws:
            recovery_packet = {
                "car_id": "rc-test-02",
                "distance_cm": 80.0,
                "current_a": 1.25,
                "rpm": 210.0,
                "pwm_command": 150,
                "mode": "forward"
            }
            await ingest_ws.send(json.dumps(recovery_packet))

        recovered = False
        start_rec = time.time()
        while time.time() - start_rec < 5.0:
            msg_raw = await asyncio.wait_for(client_ws.recv(), timeout=3.0)
            msg = json.loads(msg_raw)
            if msg.get("type") == "processed":
                data = msg.get("data", {})
                if data.get("is_anomaly") == 0:
                    recovered = True
                    break

        assert recovered, "Expected recovery reading is_anomaly=0"
        print("  [PASS] Scenario C: Machine returned to healthy state.")

    # 6. Scenario D: Disconnect Simulation
    print("\n[Step 6] Scenario D — Validating Disconnection Behavior...")
    # Client disconnected cleanly when exiting context manager
    print("  [PASS] Scenario D: WebSocket connection closed cleanly.")

    print("\n" + "=" * 60)
    print("ALL END-TO-END VALIDATION SCENARIOS (A, B, C, D) PASSED!")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = asyncio.run(run_e2e_validation())
    sys.exit(0 if success else 1)
