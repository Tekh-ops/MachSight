#!/usr/bin/env python3
"""Benchmark local LLM latency and throughput for MachSight diagnosis.

Sends a realistic evidence payload 3 times to measure:
1. Cold-load latency (first request / model loading into memory).
2. Warm latency across subsequent requests.
3. Approximate tokens/sec generation throughput.

Recommends switching to qwen2.5:3b-instruct if warm latency exceeds 20s on 8GB RAM.
"""

import json
import os
import sys
import time
from pathlib import Path
import httpx

# Ensure models/ is importable
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root / "models"))

from ml.reasoner import (
    MACHSIGHT_LLM_MODEL,
    OLLAMA_URL,
    REASONING_JSON_SCHEMA,
    SYSTEM_PROMPT,
)

# Realistic evidence payload for benchmarking
BENCHMARK_EVIDENCE = {
    "car_id": "car-01",
    "mode": "forward",
    "pwm": 200,
    "bucket": "forward:200",
    "telemetry": {
        "current_a": 6.15,
        "current_baseline": 1.75,
        "current_z": 54.2,
        "rpm": 18.0,
        "rpm_baseline": 305.0,
        "rpm_z": -35.8,
        "ratio": 0.3417,
        "ratio_baseline": 0.0057,
        "distance_cm": 82.5,
        "distance_plausible": True,
    },
    "anomaly": {
        "is_anomaly": True,
        "score": 54.2,
        "reasons": [
            "Motor current (6.15A) is 251.4% above baseline mean (1.75A) for mode 'forward' (z-score: +54.20).",
            "Wheel RPM (18.0) is 94.1% below baseline mean (305.0) for mode 'forward' (z-score: -35.88).",
        ],
    },
    "top_matches": [
        {
            "fault": "obstruction_jam",
            "score": 0.95,
            "matched": [
                "Motor current z-score (+54.20) >= 3.0 indicates severe overcurrent / stall draw",
                "Wheel RPM z-score (-35.88) <= -2.0 indicates wheel lockup / near-zero rotation",
                "Ultrasonic distance (82.5 cm) indicates clear path ahead, ruling out obstacle collision",
            ],
        }
    ],
    "window_stats": {
        "samples": 6,
        "current_mean": 6.08,
        "rpm_mean": 19.2,
        "pct_anomalous": 100.0,
        "current_slope": 0.02,
        "rpm_slope": -0.05,
    },
}


def run_benchmark():
    model_name = os.environ.get("MACHSIGHT_LLM_MODEL", MACHSIGHT_LLM_MODEL)
    base_url = os.environ.get("OLLAMA_URL", OLLAMA_URL).rstrip("/")
    api_endpoint = f"{base_url}/api/chat"

    print("=" * 65)
    print("MachSight LLM Performance Benchmark")
    print("=" * 65)
    print(f"Target Endpoint : {api_endpoint}")
    print(f"Model Under Test: {model_name}")
    print("-" * 65)

    # Pre-flight connectivity check
    try:
        with httpx.Client(timeout=5.0) as client:
            tags_resp = client.get(f"{base_url}/api/tags")
            if tags_resp.status_code != 200:
                print(f"[ERROR] Ollama returned status {tags_resp.status_code}")
                return 1
            available_models = [m.get("name") for m in tags_resp.json().get("models", [])]
            print(f"Available Models: {', '.join(available_models) if available_models else 'None found'}")
    except (httpx.ConnectError, httpx.ConnectTimeout):
        print(f"[ERROR] Cannot connect to Ollama at {base_url}.")
        print("Please ensure Ollama is running:")
        print("  1. Run: ollama serve")
        print(f"  2. Pull model: ollama pull {model_name}")
        return 1

    user_prompt = f"""EVIDENCE:
{json.dumps(BENCHMARK_EVIDENCE, indent=2)}

INVESTIGATION HISTORY:
None (first investigation step).

Evaluate the evidence above. Respond in valid JSON."""

    request_body = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "keep_alive": "30m",
        "format": REASONING_JSON_SCHEMA,
        "options": {
            "temperature": 0,
            "num_ctx": 2048,
            "num_predict": 400,
        },
    }

    latencies = []
    tokens_per_sec_list = []

    print("\nExecuting 3 inference passes...")

    for i in range(1, 4):
        run_type = "Cold-load" if i == 1 else "Warm inference"
        sys.stdout.write(f"  Run {i}/3 ({run_type})... ")
        sys.stdout.flush()

        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(api_endpoint, json=request_body)
            elapsed = time.perf_counter() - t0

            if resp.status_code != 200:
                print(f"FAILED (HTTP {resp.status_code}: {resp.text[:100]})")
                continue

            data = resp.json()
            latencies.append(elapsed)

            eval_count = data.get("eval_count")
            eval_duration_ns = data.get("eval_duration")
            if eval_count and eval_duration_ns and eval_duration_ns > 0:
                tps = eval_count / (eval_duration_ns / 1e9)
            else:
                content_len = len(data.get("message", {}).get("content", ""))
                approx_tokens = content_len / 4.0
                tps = approx_tokens / elapsed if elapsed > 0 else 0.0

            tokens_per_sec_list.append(tps)
            print(f"DONE in {elapsed:.2f}s ({tps:.1f} tok/s)")

        except httpx.TimeoutException:
            print("FAILED (Timeout > 120s)")
        except Exception as e:
            print(f"FAILED ({e})")

    if not latencies:
        print("\n[ERROR] All inference passes failed.")
        return 1

    cold_latency = latencies[0]
    warm_latencies = latencies[1:]
    avg_warm_latency = sum(warm_latencies) / len(warm_latencies) if warm_latencies else cold_latency
    avg_tps = sum(tokens_per_sec_list) / len(tokens_per_sec_list) if tokens_per_sec_list else 0.0

    print("\n" + "=" * 65)
    print("Benchmark Results Summary")
    print("=" * 65)
    print(f"Cold-load Latency  : {cold_latency:.2f}s")
    if warm_latencies:
        print(f"Warm Latencies     : {[round(l, 2) for l in warm_latencies]} s")
        print(f"Average Warm Latency: {avg_warm_latency:.2f}s")
    print(f"Generation Speed   : ~{avg_tps:.1f} tokens/second")
    print("-" * 65)

    # Assessment against 8GB RAM MacBook budget
    if avg_warm_latency > 20.0:
        print("\n[WARNING] Warm latency exceeds 20.0s cutoff for RC car telemetry diagnosis!")
        print("Running qwen2.5:7b-instruct on an 8GB RAM system may cause memory swapping.")
        print("RECOMMENDATION: Switch to the lighter qwen2.5:3b-instruct model:")
        print("  export MACHSIGHT_LLM_MODEL=qwen2.5:3b-instruct")
        print("  ollama pull qwen2.5:3b-instruct")
    else:
        print("\n[PASSED] Warm latency is within acceptable operational threshold (<= 20s).")

    print("=" * 65)
    return 0


if __name__ == "__main__":
    sys.exit(run_benchmark())
