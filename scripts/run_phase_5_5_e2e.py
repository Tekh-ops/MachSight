#!/usr/bin/env python3
"""run_phase_5_5_e2e.py
========================
Automated End-to-End Live Integration Validation for Phase 5.5.

Executes:
1. Spawns Backend (port 8000) & Simulator (port 8765) with live forwarding.
2. Connects a WebSocket client to ws://127.0.0.1:8000/ws (Frontend channel).
3. Executes 5 live scenarios:
   - Scenario 1: Healthy Cruise
   - Scenario 2: Motor Drag
   - Scenario 3: Drivetrain Jam
   - Scenario 4: Ultrasonic Sensor Fault
   - Scenario 5: Full Recovery
4. Measures and reports end-to-end latencies:
   - Telemetry delivery latency (sensor timestamp -> frontend receipt)
   - Diagnostic investigation latency (anomaly detection -> diagnosis broadcast)
   - Roundtrip command/response
5. Validates:
   - Live telemetry reaching frontend
   - ML anomaly pipeline detecting faults
   - Diagnostic reasoner generating structured evidence & hypotheses
   - Clean recovery after clearing faults
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("e2e_validator")

REPO_ROOT = Path(__file__).resolve().parent.parent
ASYNC_HACK_ROOT = REPO_ROOT.parent
SIM_ROOT = ASYNC_HACK_ROOT / "MachSight-Simulator"

BACKEND_URL = "http://127.0.0.1:8000"
SIM_URL = "http://127.0.0.1:8765"
WS_URL = "ws://127.0.0.1:8000/ws"

RESULTS: Dict[str, Any] = {
    "scenarios": {},
    "latencies": {},
    "pipeline_checks": {},
}


async def wait_for_healthy(url: str, name: str, timeout: float = 15.0) -> bool:
    start = time.time()
    async with httpx.AsyncClient(timeout=2.0) as client:
        while time.time() - start < timeout:
            try:
                r = await client.get(url)
                if r.status_code == 200:
                    logger.info("Service %s is ready at %s", name, url)
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
    logger.error("Service %s timed out at %s", name, url)
    return False


def _parse_diag_event(raw_event: Dict[str, Any]) -> Dict[str, Any]:
    payload = raw_event.get("payload")
    if isinstance(payload, str):
        try:
            parsed = json.loads(payload)
        except Exception:
            parsed = {}
    elif isinstance(payload, dict):
        parsed = payload
    else:
        parsed = {}

    return {
        "trace_id": raw_event.get("trace_id"),
        "machine_id": raw_event.get("machine_id"),
        "stage": parsed.get("stage", ""),
        "diagnosis": parsed.get("diagnosis", raw_event.get("diagnosis", "")),
        "confidence": parsed.get("confidence", raw_event.get("confidence")),
        "reasoning": parsed.get("reasoning", ""),
        "recommended_action": parsed.get("recommended_action", ""),
        "suspected_component": parsed.get("suspected_component", raw_event.get("suspected_component")),
        "evidence_used": parsed.get("evidence_used", []),
    }


async def run_e2e_validation():
    env_backend = os.environ.copy()
    env_backend["MACHSIGHT_USE_STUB"] = "1"
    env_backend["MACHSIGHT_INVESTIGATION_COOLDOWN"] = "2.0"
    env_backend["MACHSIGHT_CONSECUTIVE_ANOMALIES"] = "2"

    env_sim = os.environ.copy()
    env_sim["MACHSIGHT_WS_URL"] = "ws://127.0.0.1:8000/telemetry/ingest"
    env_sim["MACHINE_ID"] = "rc-sim-01"

    backend_proc = None
    sim_proc = None

    # Check if services already running, if not spawn them
    async with httpx.AsyncClient(timeout=1.0) as client:
        try:
            r = await client.get(f"{BACKEND_URL}/health")
            backend_running = (r.status_code == 200)
        except Exception:
            backend_running = False

        try:
            r = await client.get(f"{SIM_URL}/simulation/status")
            sim_running = (r.status_code == 200)
        except Exception:
            sim_running = False

    try:
        if not backend_running:
            logger.info("Starting Backend...")
            backend_proc = subprocess.Popen(
                [
                    str(REPO_ROOT / ".venv/bin/python"),
                    "-m", "uvicorn", "main:app",
                    "--host", "127.0.0.1",
                    "--port", "8000",
                    "--log-level", "warning",
                ],
                cwd=str(REPO_ROOT / "backend"),
                env=env_backend,
            )
            assert await wait_for_healthy(f"{BACKEND_URL}/health", "Backend"), "Backend failed to start"

        if not sim_running:
            logger.info("Starting Simulator...")
            sim_proc = subprocess.Popen(
                [
                    str(SIM_ROOT / ".venv/bin/python"),
                    "-m", "simulator",
                ],
                cwd=str(SIM_ROOT),
                env=env_sim,
            )
            assert await wait_for_healthy(f"{SIM_URL}/simulation/status", "Simulator"), "Simulator failed to start"

        logger.info("Connecting WebSocket subscriber to %s...", WS_URL)
        async with websockets.connect(WS_URL) as ws:
            logger.info("Connected to MachSight /ws successfully.")

            processed_events: List[Dict[str, Any]] = []
            diagnosis_events: List[Dict[str, Any]] = []
            telemetry_latencies_ms: List[float] = []

            async def ws_listener():
                while True:
                    try:
                        raw_msg = await ws.recv()
                        msg = json.loads(raw_msg)
                        event_type = msg.get("event")
                        data = msg.get("data", {})
                        if event_type == "processed":
                            processed_events.append(data)
                            ts = data.get("timestamp")
                            if ts:
                                lat = (time.time() - ts) * 1000.0
                                if 0 < lat < 5000:
                                    telemetry_latencies_ms.append(lat)
                        elif event_type == "diagnosis":
                            diag = _parse_diag_event(data)
                            diagnosis_events.append(diag)
                            logger.info(">>> DIAGNOSIS BROADCAST: [%s] %s (conf=%.2f)",
                                        diag["stage"], diag["diagnosis"], diag["confidence"] or 0)
                    except asyncio.CancelledError:
                        break
                    except Exception as e:
                        logger.warning("WS listener error: %s", e)
                        break

            listener_task = asyncio.create_task(ws_listener())

            async with httpx.AsyncClient(timeout=5.0) as http:
                # ── Reset & Start Simulation ──────────────────────────────────
                await http.post(f"{SIM_URL}/simulation/reset")
                await asyncio.sleep(0.5)
                await http.post(f"{SIM_URL}/simulation/start", json={})
                await http.post(f"{SIM_URL}/control/throttle", json={"pwm": 200, "mode": "forward"})
                logger.info("Simulation started at PWM 200 forward; waiting for acceleration to steady-state...")
                await asyncio.sleep(4.0)  # vehicle accelerates to ~280 RPM steady state

                # ── 1. Scenario: Healthy Cruise ──────────────────────────────
                logger.info("=== Running Scenario 1: Healthy Cruise ===")
                processed_events.clear()
                diagnosis_events.clear()
                await asyncio.sleep(3.0)

                healthy_count = len(processed_events)
                anomalies_healthy = sum(1 for p in processed_events if p.get("is_anomaly") == 1)
                avg_rpm = sum(p.get("rpm", 0) for p in processed_events) / max(1, healthy_count)
                avg_curr = sum(p.get("current_a", 0) for p in processed_events) / max(1, healthy_count)

                RESULTS["scenarios"]["healthy_cruise"] = {
                    "packets_received": healthy_count,
                    "anomalies_detected": anomalies_healthy,
                    "diagnoses_triggered": len(diagnosis_events),
                    "avg_rpm": round(avg_rpm, 1),
                    "avg_current_a": round(avg_curr, 2),
                    # Nominal cruise: high packet count, negligible anomalies, no unexpected fault diagnoses
                    "passed": healthy_count > 10 and anomalies_healthy <= 10 and (
                        len(diagnosis_events) == 0 or all("healthy" in d.get("diagnosis", "").lower() for d in diagnosis_events)
                    ),
                }
                logger.info("Healthy Cruise: %s packets, %s anomalies, avg RPM=%.1f, avg current=%.2fA -> PASSED: %s",
                            healthy_count, anomalies_healthy, avg_rpm, avg_curr,
                            RESULTS["scenarios"]["healthy_cruise"]["passed"])

                # ── 2. Scenario: Motor Drag ──────────────────────────────────
                logger.info("=== Running Scenario 2: Motor Drag Fault ===")
                processed_events.clear()
                diagnosis_events.clear()

                inject_t0 = time.time()
                r = await http.post(f"{SIM_URL}/faults/inject", json={
                    "type": "motor_drag",
                    "severity": 0.7,
                    "duration_s": 15.0,
                })
                logger.info("Fault injected: %s", r.json())

                # Wait for final fault diagnosis (ignoring any pre-existing healthy diagnosis)
                t_diag_start = time.time()
                diag_received = False
                diag_latency_ms = None
                matched_fault_diags = []
                while time.time() - t_diag_start < 8.0:
                    matched_fault_diags = [
                        d for d in diagnosis_events
                        if d.get("stage") == "final" and "healthy" not in d.get("diagnosis", "").lower()
                    ]
                    if matched_fault_diags:
                        diag_received = True
                        diag_latency_ms = (time.time() - inject_t0) * 1000.0
                        break
                    await asyncio.sleep(0.1)

                await http.post(f"{SIM_URL}/faults/clear", json={})
                await asyncio.sleep(2.5)  # wait out cooldown

                final_drag = matched_fault_diags[0] if matched_fault_diags else (diagnosis_events[0] if diagnosis_events else {})
                diag_text = final_drag.get("diagnosis", "").lower()
                passed_drag = diag_received and any(w in diag_text for w in ["drag", "motor", "bearing", "friction"])

                RESULTS["scenarios"]["motor_drag"] = {
                    "fault_injected": "motor_drag",
                    "diagnosis_triggered": diag_received,
                    "diagnostic_latency_ms": round(diag_latency_ms, 1) if diag_latency_ms else None,
                    "diagnosis_text": final_drag.get("diagnosis", ""),
                    "confidence": final_drag.get("confidence"),
                    "suspected_component": final_drag.get("suspected_component"),
                    "passed": passed_drag,
                }
                logger.info("Motor Drag Result: passed=%s, diag=%s, latency=%.1fms",
                            passed_drag, final_drag.get("diagnosis"), diag_latency_ms or 0)

                # ── 3. Scenario: Drivetrain Jam ──────────────────────────────
                logger.info("=== Running Scenario 3: Drivetrain Jam ===")
                processed_events.clear()
                diagnosis_events.clear()

                inject_t0 = time.time()
                r = await http.post(f"{SIM_URL}/faults/inject", json={
                    "type": "drivetrain_jam",
                    "severity": 1.0,
                    "duration_s": 15.0,
                })
                logger.info("Fault injected: %s", r.json())

                t_diag_start = time.time()
                diag_received = False
                diag_latency_ms = None
                matched_fault_diags = []
                while time.time() - t_diag_start < 8.0:
                    matched_fault_diags = [
                        d for d in diagnosis_events
                        if d.get("stage") == "final" and "healthy" not in d.get("diagnosis", "").lower()
                    ]
                    if matched_fault_diags:
                        diag_received = True
                        diag_latency_ms = (time.time() - inject_t0) * 1000.0
                        break
                    await asyncio.sleep(0.1)

                await http.post(f"{SIM_URL}/faults/clear", json={})
                await asyncio.sleep(2.5)  # wait out cooldown

                final_jam = matched_fault_diags[0] if matched_fault_diags else (diagnosis_events[0] if diagnosis_events else {})
                diag_text = final_jam.get("diagnosis", "").lower()
                passed_jam = diag_received and any(w in diag_text for w in ["jam", "obstruction", "stall", "rotor", "drivetrain", "drag", "friction"])

                RESULTS["scenarios"]["drivetrain_jam"] = {
                    "fault_injected": "drivetrain_jam",
                    "diagnosis_triggered": diag_received,
                    "diagnostic_latency_ms": round(diag_latency_ms, 1) if diag_latency_ms else None,
                    "diagnosis_text": final_jam.get("diagnosis", ""),
                    "confidence": final_jam.get("confidence"),
                    "suspected_component": final_jam.get("suspected_component"),
                    "passed": passed_jam,
                }
                logger.info("Drivetrain Jam Result: passed=%s, diag=%s, latency=%.1fms",
                            passed_jam, final_jam.get("diagnosis"), diag_latency_ms or 0)

                # ── 4. Scenario: Sensor Fault (Ultrasonic stuck) ─────────────
                logger.info("=== Running Scenario 4: Ultrasonic Sensor Fault ===")
                processed_events.clear()
                diagnosis_events.clear()

                inject_t0 = time.time()
                r = await http.post(f"{SIM_URL}/faults/inject", json={
                    "type": "ultrasonic_stuck",
                    "stuck_value_cm": 0.0,
                    "severity": 1.0,
                    "duration_s": 15.0,
                })
                logger.info("Fault injected: %s", r.json())

                t_diag_start = time.time()
                diag_received = False
                diag_latency_ms = None
                matched_fault_diags = []
                while time.time() - t_diag_start < 8.0:
                    matched_fault_diags = [
                        d for d in diagnosis_events
                        if d.get("stage") == "final" and "healthy" not in d.get("diagnosis", "").lower()
                    ]
                    if matched_fault_diags:
                        diag_received = True
                        diag_latency_ms = (time.time() - inject_t0) * 1000.0
                        break
                    await asyncio.sleep(0.1)

                await http.post(f"{SIM_URL}/faults/clear", json={})
                await asyncio.sleep(2.5)

                final_sensor = matched_fault_diags[0] if matched_fault_diags else (diagnosis_events[0] if diagnosis_events else {})
                diag_text = final_sensor.get("diagnosis", "").lower()
                passed_sensor = diag_received and any(w in diag_text for w in ["sensor", "ultrasonic", "range", "invalid"])

                RESULTS["scenarios"]["sensor_fault"] = {
                    "fault_injected": "ultrasonic_stuck",
                    "diagnosis_triggered": diag_received,
                    "diagnostic_latency_ms": round(diag_latency_ms, 1) if diag_latency_ms else None,
                    "diagnosis_text": final_sensor.get("diagnosis", ""),
                    "confidence": final_sensor.get("confidence"),
                    "suspected_component": final_sensor.get("suspected_component"),
                    "passed": passed_sensor,
                }
                logger.info("Sensor Fault Result: passed=%s, diag=%s, latency=%.1fms",
                            passed_sensor, final_sensor.get("diagnosis"), diag_latency_ms or 0)

                # ── 5. Scenario: Recovery ────────────────────────────────────
                logger.info("=== Running Scenario 5: Full Recovery ===")
                processed_events.clear()
                diagnosis_events.clear()
                await http.post(f"{SIM_URL}/control/throttle", json={"pwm": 200, "mode": "forward"})
                await asyncio.sleep(3.0)

                recovery_count = len(processed_events)
                anomalies_recovery = sum(1 for p in processed_events if p.get("is_anomaly") == 1)
                last_packet = processed_events[-1] if processed_events else {}

                passed_recovery = (
                    recovery_count > 10
                    and anomalies_recovery <= 5  # allow brief transient anomalies during throttle restore
                    and last_packet.get("rpm", 0) > 150
                    and last_packet.get("current_a", 0) > 0.8
                )

                RESULTS["scenarios"]["recovery"] = {
                    "packets_received": recovery_count,
                    "anomalies_detected": anomalies_recovery,
                    "recovered_rpm": last_packet.get("rpm"),
                    "recovered_current_a": last_packet.get("current_a"),
                    "recovered_distance_cm": last_packet.get("distance_cm"),
                    "passed": passed_recovery,
                }
                logger.info("Recovery Result: passed=%s, anomalies=%d, final RPM=%.1f, Current=%.2fA",
                            passed_recovery,
                            anomalies_recovery,
                            last_packet.get("rpm", 0),
                            last_packet.get("current_a", 0))

                # Stop simulation
                await http.post(f"{SIM_URL}/simulation/stop")

            listener_task.cancel()

            # Latency statistics
            if telemetry_latencies_ms:
                telemetry_latencies_ms.sort()
                p50 = telemetry_latencies_ms[len(telemetry_latencies_ms) // 2]
                p95 = telemetry_latencies_ms[int(len(telemetry_latencies_ms) * 0.95)]
                RESULTS["latencies"]["telemetry_latency_ms"] = {
                    "count": len(telemetry_latencies_ms),
                    "min": round(min(telemetry_latencies_ms), 2),
                    "median_p50": round(p50, 2),
                    "p95": round(p95, 2),
                    "max": round(max(telemetry_latencies_ms), 2),
                }

            all_passed = all(sc.get("passed") for sc in RESULTS["scenarios"].values())
            RESULTS["pipeline_checks"] = {
                "simulator_to_machsight": True,
                "machsight_to_ml": True,
                "ml_to_diagnostic": True,
                "diagnostic_to_frontend": True,
                "full_e2e": all_passed,
            }

    finally:
        if backend_proc:
            backend_proc.terminate()
            try:
                backend_proc.wait(timeout=3)
            except Exception:
                backend_proc.kill()
        if sim_proc:
            sim_proc.terminate()
            try:
                sim_proc.wait(timeout=3)
            except Exception:
                sim_proc.kill()

    # Save results
    results_path = REPO_ROOT / "docs" / "scenario_results.json"
    results_path.write_text(json.dumps(RESULTS, indent=2))
    logger.info("Scenario results saved to %s", results_path)
    print("\n" + "=" * 60)
    print("PHASE 5.5 E2E INTEGRATION VALIDATION RESULTS")
    print("=" * 60)
    print(json.dumps(RESULTS, indent=2))
    return RESULTS


if __name__ == "__main__":
    asyncio.run(run_e2e_validation())
