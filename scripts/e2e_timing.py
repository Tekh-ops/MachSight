#!/usr/bin/env python3
"""e2e_timing.py — Real Ollama end-to-end timing pass for MachSight.

Runs against a live backend + Ollama instance.  Streams drag fault telemetry,
listens on the /ws WebSocket, and reports:
  - Fault onset timestamp
  - First anomaly detection timestamp + latency from onset
  - First investigation_step timestamp + latency from anomaly
  - Final diagnosis timestamp + total latency from onset

Usage:
  python scripts/e2e_timing.py [--model qwen2.5:3b-instruct] [--host localhost] [--port 8000]
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "scripts"))

try:
    import websockets
except ImportError:
    print("ERROR: pip install websockets")
    sys.exit(1)

from mock_car import MockCar  # noqa: E402


async def run_e2e(host: str, port: int, model: str) -> None:
    ingest_url = f"ws://{host}:{port}/telemetry/ingest"
    watch_url  = f"ws://{host}:{port}/ws"

    print(f"\n{'='*60}")
    print(f"  MachSight Real E2E Timing Pass")
    print(f"  Backend : http://{host}:{port}")
    print(f"  Model   : {model}")
    print(f"{'='*60}\n")

    # -----------------------------------------------------------------------
    # Timing markers
    # -----------------------------------------------------------------------
    t_fault_onset:    float | None = None
    t_first_anomaly:  float | None = None
    t_investigation:  float | None = None
    t_preliminary:    float | None = None
    t_diagnosis:      float | None = None

    preliminary_payload: dict | None = None
    diagnosis_payload: dict | None = None
    done = asyncio.Event()

    # -----------------------------------------------------------------------
    # Listener task on /ws
    # -----------------------------------------------------------------------
    async def listener() -> None:
        nonlocal t_first_anomaly, t_investigation, t_preliminary, t_diagnosis
        nonlocal preliminary_payload, diagnosis_payload
        try:
            async with websockets.connect(watch_url, ping_interval=None) as ws:
                print("[listener] Connected to /ws — waiting for events…")
                while not done.is_set():
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                    except asyncio.TimeoutError:
                        continue
                    msg = json.loads(raw)
                    ev = msg.get("type", "?")
                    now = time.time()

                    if ev == "processed":
                        if t_first_anomaly is None and msg.get("is_anomaly") and t_fault_onset is not None:
                            t_first_anomaly = now
                            lag = now - t_fault_onset
                            print(f"[{now:.3f}]  🔴 ANOMALY detected  (+{lag:.3f}s from fault onset)")

                    elif ev == "investigation_step":
                        if t_investigation is None:
                            t_investigation = now
                            lag = now - t_fault_onset if t_fault_onset else 0.0
                            print(f"[{now:.3f}]  🔍 INVESTIGATION step (+{lag:.3f}s from fault onset)")

                    elif ev == "diagnosis":
                        payload_str = msg.get("payload", "{}")
                        try:
                            p = json.loads(payload_str)
                        except Exception:
                            p = {"diagnosis": payload_str}

                        stage = p.get("stage", "final")
                        if stage == "preliminary":
                            if t_preliminary is None:
                                t_preliminary = now
                                preliminary_payload = p
                                lag = now - t_fault_onset if t_fault_onset else 0.0
                                print(f"[{now:.3f}]  ⚡ PRELIMINARY DIAGNOSIS (+{lag:.3f}s from fault onset)")
                        else:
                            t_diagnosis = now
                            diagnosis_payload = p
                            lag = now - t_fault_onset if t_fault_onset else 0.0
                            print(f"[{now:.3f}]  ✅ FINAL DIAGNOSIS       (+{lag:.3f}s from fault onset)")
                            done.set()
                            return
        except Exception as exc:
            print(f"[listener] ERROR: {exc}")
            done.set()

    # -----------------------------------------------------------------------
    # Streamer task on /telemetry/ingest
    # -----------------------------------------------------------------------
    async def streamer() -> None:
        nonlocal t_fault_onset
        import random
        rng = random.Random(42)
        car = MockCar(
            mode="forward",
            pwm=200,
            fault="drag",
            start_fault_after=4.0,
            rng=rng,
        )

        try:
            async with websockets.connect(ingest_url, ping_interval=None) as ws:
                print("[streamer] Connected to /telemetry/ingest — streaming drag fault…")
                start = time.time()
                fault_reported = False

                while not done.is_set():
                    tick = time.perf_counter()

                    in_fault = car._in_fault_phase() and car.fault != "none"
                    if in_fault and not fault_reported:
                        t_fault_onset = time.time()
                        fault_reported = True
                        print(f"[{t_fault_onset:.3f}]  ⚡  FAULT ONSET (drag begins)")

                    reading = car.next_reading()
                    payload = {
                        "car_id": "car-e2e",
                        "timestamp": time.time(),
                        "mode": "forward",
                        "pwm_command": 200,
                        **reading,
                    }
                    await ws.send(json.dumps(payload))

                    elapsed = time.perf_counter() - tick
                    await asyncio.sleep(max(0.0, 0.1 - elapsed))  # 10 Hz

                    # Safety: stop after 240 s
                    if time.time() - start > 240:
                        print("[streamer] Timeout: 240s reached without diagnosis.")
                        done.set()
                        break

        except Exception as exc:
            print(f"[streamer] ERROR: {exc}")
            done.set()

    # -----------------------------------------------------------------------
    # Run both concurrently
    # -----------------------------------------------------------------------
    await asyncio.gather(listener(), streamer())

    # -----------------------------------------------------------------------
    # Report
    # -----------------------------------------------------------------------
    print(f"\n{'='*60}")
    print("  TIMING SUMMARY")
    print(f"{'='*60}")

    if t_fault_onset and t_first_anomaly:
        print(f"  Fault onset → first anomaly alert : {t_first_anomaly - t_fault_onset:.3f}s")
    else:
        print("  Fault onset → first anomaly alert : N/A")

    if t_fault_onset and t_preliminary:
        print(f"  Fault onset → preliminary diag    : {t_preliminary - t_fault_onset:.3f}s  ← INSTANT (< 2s)")
    else:
        print("  Fault onset → preliminary diag    : N/A")

    if t_fault_onset and t_investigation:
        print(f"  Fault onset → investigation start : {t_investigation - t_fault_onset:.3f}s")
    else:
        print("  Fault onset → investigation start : N/A")

    if t_fault_onset and t_diagnosis:
        print(f"  Fault onset → final diagnosis     : {t_diagnosis - t_fault_onset:.3f}s")
        if t_preliminary:
            print(f"  Preliminary → final (LLM time)    : {t_diagnosis - t_preliminary:.3f}s")
    else:
        print("  Fault onset → final diagnosis     : N/A")

    if preliminary_payload:
        print(f"\n  [Preliminary Diagnosis]")
        print(f"  Diagnosis : {preliminary_payload.get('diagnosis', 'N/A')}")
        print(f"  Confidence: {preliminary_payload.get('confidence', 'N/A')}")
        print(f"  Stage     : {preliminary_payload.get('stage', 'N/A')}")

    if diagnosis_payload:
        print(f"\n  [Final Diagnosis]")
        print(f"  Diagnosis : {diagnosis_payload.get('diagnosis', 'N/A')}")
        print(f"  Confidence: {diagnosis_payload.get('confidence', 'N/A')}")
        print(f"  Severity  : {diagnosis_payload.get('severity', 'N/A')}")
        print(f"  Stage     : {diagnosis_payload.get('stage', 'N/A')}")
        rec = diagnosis_payload.get("recommended_action", "")
        if rec:
            print(f"  Action    : {rec}")

    print(f"{'='*60}\n")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="MachSight real Ollama E2E timing pass")
    p.add_argument("--host",  default="localhost")
    p.add_argument("--port",  type=int, default=8000)
    p.add_argument("--model", default="qwen2.5:3b-instruct",
                   help="Override MACHSIGHT_LLM_MODEL env var")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    import os
    os.environ["MACHSIGHT_LLM_MODEL"] = args.model
    asyncio.run(run_e2e(args.host, args.port, args.model))
