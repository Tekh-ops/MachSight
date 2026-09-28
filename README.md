# MachSight

**Real-time AI diagnostics for an instrumented RC vehicle.**

MachSight ingests high-frequency telemetry from an RC car, scores every sample against
conditioned healthy baselines using multivariate statistics, classifies the physical fault
signature when something is wrong, and hands the evidence to a **local** LLM that produces a
human-readable diagnosis and a recommended action. Everything runs on one machine, offline,
with no cloud dependency.

```
┌──────────┐   ws://…/telemetry/ingest   ┌──────────────────────── FastAPI backend ─────────────────────┐
│ RC car   │ ──────────────────────────▶ │ ingest → SQLite → analyze() → anomaly gate → investigation  │
│ or       │                             │   (reference_builder · detector · features · classify)      │
│ mock_car │                             │   → reasoner (Ollama qwen2.5) → broadcast                 │
└──────────┘                             └────────────────────────────┬──────────────────────────────┘
                                                                     │ ws://…/ws  (processed · investigation_step · diagnosis)
                                                            ┌────────▼─────────┐        ┌──────────────┐
                                                            │   Dashboard      │        │  REST /api/* │
                                                            │  (React/Vite)    │        │  history     │
                                                            └──────────────────┘        └──────────────┘
```

---

## Table of Contents

- [What MachSight Does](#what-machsight-does)
- [Core Concepts](#core-concepts)
- [Repository Layout](#repository-layout)
- [Architecture](#architecture)
  - [1. Reference Builder — the healthy baseline](#1-reference-builder--the-healthy-baseline)
  - [2. Detector — statistical anomaly scoring](#2-detector--statistical-anomaly-scoring)
  - [3. Features — conditioning and window statistics](#3-features--conditioning-and-window-statistics)
  - [4. Classifier — physical fault signatures](#4-classifier--physical-fault-signatures)
  - [5. Pipeline — the `analyze()` / `build_evidence()` facade](#5-pipeline--the-analyze--build_evidence-facade)
  - [6. Reasoner — local LLM + deterministic fallback](#6-reasoner--local-llm--deterministic-fallback)
  - [7. Backend — ingestion, investigation loop, broadcast](#7-backend--ingestion-investigation-loop-broadcast)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Scripts Reference](#scripts-reference)
- [Frontend Status](#frontend-status)
- [Design Decisions & Invariants](#design-decisions--invariants)
- [Known Gaps & Technical Debt](#known-gaps--technical-debt)
- [Future Work / Roadmap](#future-work--roadmap)
- [Datasets](#datasets)

---

## What MachSight Does

| Capability | Implementation |
|---|---|
| **Telemetry ingestion** | WebSocket at `/telemetry/ingest`, JSON frames, sustained 10 Hz+ per vehicle |
| **Conditioned anomaly detection** | Mahalanobis distance over `(current_a, rpm)` against a `(mode, pwm_command)` baseline bucket, with nearest-PWM and z-score fallbacks |
| **Sensor plausibility checks** | Physical range validation and frozen-signal detection on the ultrasonic channel |
| **Window/temporal analysis** | Rolling means, std devs, least-squares trend slopes, `% anomalous`, max distance step |
| **Fault classification** | Rule-based scoring of four physical fault signatures with matched/contradicting evidence |
| **Autonomous multi-hop reasoning** | LLM may request more data, the system collects a real telemetry window, re-conditions, and reasons again (≤ 3 hops) |
| **Progressive diagnosis** | A preliminary rule-based diagnosis is broadcast in < 2 ms, then refined by the LLM |
| **Graceful degradation** | Every LLM failure mode (unreachable, timeout, HTTP error, malformed JSON) resolves to a deterministic, fully-structured rule-based diagnosis |
| **Full audit trail** | Every raw reading, derived feature, and reasoning step persisted in SQLite |
| **Dashboard API** | Live WebSocket broadcast + REST history/status endpoints |

**Target fault classes:** `mechanical_drag`, `obstruction_jam`, `sensor_fault`, and
`motor_mismatch` (the last is scaffolding for a future dual-motor chassis).

---

## Core Concepts

### Telemetry reading

A single sample from the vehicle. This is the unit that flows through the entire system.

| Field | Type | Unit | Description |
|---|---|---|---|
| `timestamp` | float | epoch seconds | Acquisition time; auto-filled by the backend if the sender omits it |
| `car_id` | string | — | Vehicle identifier, e.g. `"car-01"` |
| `distance_cm` | float | cm | HC-SR04 ultrasonic range. Valid range `[2.0, 400.0]` |
| `current_a` | float | A | Motor current draw |
| `rpm` | float | RPM | Wheel rotation speed |
| `pwm_command` | int | 0–255 | Commanded PWM duty |
| `mode` | string | — | `idle` \| `forward` \| `turning_left` \| `turning_right` \| `braking` |

### Operational bucket

The single most important idea in the system. A reading of `2.1 A @ 0 RPM` is a catastrophic
anomaly while braking and completely normal while idle. MachSight therefore **never** compares
against one global distribution — it buckets healthy data by `(mode, pwm_command)` and scores
each reading against its own bucket. A drift in one bucket does not poison the others.

### The three-layer diagnosis

1. **Statistics** say *something is wrong* and by how much (Mahalanobis distance, z-scores).
2. **Rules** say *what kind of thing is wrong* (drag vs. jam vs. sensor) and produce the
   matched/contradicting evidence trail.
3. **The LLM** says *what to tell a human and what to do about it*, in natural language.

Layer 3 is never load-bearing for correctness. If the LLM is down, the system still emits a
complete, correctly-shaped diagnosis derived from layer 2.

---

## Repository Layout

```
MachSight/
├── backend/                    FastAPI service (ingest, broadcast, investigation loop, REST)
│   ├── main.py                 Application: WS ingest, WS broadcast, REST API, investigation loop
│   ├── db.py                   SQLite schema + tiny query helper (init on import)
│   ├── ml_stub.py              Minimal rule-only reasoner used when MACHSIGHT_USE_STUB=1
│   ├── test_backend.py         Integration tests for the investigation flow and REST API
│   ├── requirements.txt        Python dependencies
│   ├── README.md               Detailed backend/event contract documentation
│   └── telemetry.db            Runtime database (gitignored)
│
├── models/ml/                  The ML / statistics layer (importable as `ml.*`)
│   ├── schemas.py              TypedDicts: TelemetryReading, DetectorOutput, BucketReference
│   ├── reference_builder.py    Build/serialize the conditioned baseline (reference.pkl)
│   ├── detector.py             Mahalanobis / z-score scoring + sensor plausibility
│   ├── features.py             process_reading() and process_window()
│   ├── classify.py             Rule-based fault signatures (FAULT_SIGNATURES + classify())
│   ├── pipeline.py             analyze() and build_evidence() facade
│   ├── reasoner.py             Ollama client, schema validation, deterministic fallback
│   ├── mock_data_generator.py  Synthetic healthy/faulty telemetry for tests and fixtures
│   ├── healthy_telemetry.csv   600 healthy samples (12 buckets × 50)
│   ├── reference.pkl           Serialized baseline, built from the CSV above
│   └── test_*.py               Unit tests (detector, features/classification, reasoner)
│
├── scripts/                    Simulators, replayers, benchmarks, and demos
│   ├── mock_car.py             Stateful RC car simulator (healthy → drag | jam | sensor_fault)
│   ├── replay.py               Replay a .db or .csv trace at original or scaled timing
│   ├── bench_llm.py            Ollama latency / tokens-per-second benchmark
│   ├── e2e_timing.py           Real end-to-end latency measurement against a live backend
│   ├── test_e2e_mock_car.py    E2E pytest with a deterministic mocked LLM
│   ├── send_test.py            One-off healthy reading
│   ├── send_anomaly.py         One-off anomalous reading
│   └── run_demo.sh             Preflight + backend launcher + guided demo command list
│
├── frontend/                   React 19 + Vite + TypeScript dashboard
│   ├── IndustrialDoctor.tsx    The dashboard component (~1900 lines, currently a self-contained mockup)
│   ├── src/main.tsx            React entry point
│   ├── index.html              Host page (Tailwind via CDN)
│   └── vite.config.ts          Vite config
│
├── dataset/                    Reference datasets (see [Datasets](#datasets))
├── docs/CONTEXT.md             Detailed system context, verification log, and gap list
└── README.md                   This file
```

---

## Architecture

### 1. Reference Builder — the healthy baseline

`models/ml/reference_builder.py`

`build_reference_set(csv_path)` reads a CSV of **healthy** telemetry and produces, for every
`(mode, pwm_command)` pair:

- `mean_vector` — `[current_a_mean, rpm_mean]`
- `covariance_matrix` — the 2×2 empirical covariance of `(current_a, rpm)`
- `inv_covariance_matrix` — precomputed inverse (so scoring is a single matrix lookup at runtime)
- `current_mean/std`, `rpm_mean/std` — marginal statistics
- `sample_count` — used to decide whether the multivariate metric is trustworthy
- `use_zscore_fallback` — `True` when `sample_count < 20` or the covariance is singular

Robustness details that matter:

- The covariance is regularized with `Σ_reg = Σ + 1e-6 · I` before inversion. Without this the
  `idle:0` bucket is singular (RPM is identically 0, so its variance is 0) and the inverse blows up.
- `scipy.linalg.inv` failing falls back to `pinv` and forces the z-score path.
- `mode_pwms` records a sorted list of available PWM levels per mode, which is what the
  nearest-PWM lookup in the detector iterates over.

The result is serialized to `reference.pkl` with `pickle` (`save_reference_set` /
`load_reference_set`). No training framework, no model artifacts — just statistics.

**Current baseline (600 healthy samples, 50 per bucket):**

| Bucket | current_a (A) | rpm | Bucket | current_a (A) | rpm |
|---|---|---|---|---|---|
| `idle:0` | 0.119 ± 0.011 | 0.0 ± 0.0 | `turning_left:100` | 1.052 ± 0.046 | 104.4 ± 5.1 |
| `braking:0` | 0.652 ± 0.074 | 14.8 ± 4.9 | `turning_left:150` | 1.507 ± 0.063 | 181.8 ± 6.6 |
| `braking:50` | 1.378 ± 0.089 | 39.7 ± 7.6 | `turning_left:200` | 2.106 ± 0.091 | 266.7 ± 9.2 |
| `forward:100` | 0.859 ± 0.035 | 123.8 ± 4.3 | `turning_right:100` | 1.054 ± 0.053 | 105.0 ± 4.7 |
| `forward:150` | 1.252 ± 0.059 | 210.0 ± 5.9 | `turning_right:150` | 1.516 ± 0.058 | 179.1 ± 7.3 |
| `forward:200` | 1.753 ± 0.075 | 303.2 ± 8.6 | `turning_right:200` | 2.133 ± 0.096 | 265.9 ± 8.6 |

Rebuild it with:

```bash
python -c "
import sys; sys.path.insert(0, 'models')
from ml.reference_builder import build_reference_set, save_reference_set
save_reference_set(build_reference_set('models/ml/healthy_telemetry.csv'), 'models/ml/reference.pkl')
"
```

### 2. Detector — statistical anomaly scoring

`models/ml/detector.py` → `score_reading(reading, reference, threshold=3.0)`

1. **Bucket resolution.** Try exact `mode:pwm_command`. If absent, `_find_nearest_pwm_bucket()`
   picks the closest available PWM for that mode (falling back to the first bucket in the
   reference if the mode is entirely unknown) and appends an explanatory note to `reasons`.
2. **Distance metric.**
   - Normal: Mahalanobis distance over the conditioned baseline
     `D²(x) = (x − μ)ᵀ Σ⁻¹ (x − μ)`, with `x = [current_a, rpm]`
   - Fallback: Euclidean z-score `D = sqrt(z_current² + z_rpm²)` when the bucket has too few
     samples or the covariance is numerically unstable
3. **Per-feature z-scores** are always computed (with an epsilon floor on the standard
   deviation) because they are what the classifier and the LLM prompt actually reason about.
4. **Sensor plausibility.** `distance_cm` outside `[2.0, 400.0]`, NaN, or infinite forces
   `is_anomaly = True` immediately, regardless of the statistical score.
5. **Human-readable reasons.** Deviations ≥ 15 % or |z| ≥ 2.0 produce sentences like
   *"Motor current (6.00A) is 242.9% above baseline mean (1.75A) for mode 'forward' (z-score: +53.12)."*

Returns `DetectorOutput` (see [`schemas.py`](models/ml/schemas.py)): `is_anomaly`,
`anomaly_score`, `mode`, `pwm_command`, `matched_pwm`, `reasons`, and per-feature
`value` / `baseline_mean` / `baseline_std` / `z_score` / `pct_diff`.

### 3. Features — conditioning and window statistics

`models/ml/features.py`

**`process_reading(raw, reference, window=None)`** — wraps `score_reading()` and adds the
context the classifier needs:

- `current_rpm_ratio = current_a / max(rpm, 1)` — the load-to-speed ratio, guarded against
  division by zero
- `distance_plausible` — physical bounds + a frozen-signal check (σ < 1e-4 across ≥ 3 samples
  while the vehicle is moving)
- `bucket_used` — which baseline was actually consulted (may differ from the commanded PWM)
- Baseline means/stds and the derived `baseline_current_rpm_ratio`, so every downstream
  comparison is expressed relative to its own bucket rather than an absolute number

**`process_window(readings, reference=None)`** — temporal statistics over a list of readings:

| Field | Meaning |
|---|---|
| `count` | Samples in the window |
| `current_mean` / `current_std` | Sample mean and std (`ddof=1`) of motor current |
| `rpm_mean` / `rpm_std` | Same for wheel RPM |
| `current_trend_slope` / `rpm_trend_slope` | Least-squares slope vs. sample index (rise/fall detection) |
| `distance_mean` / `distance_std` | Ultrasonic statistics |
| `pct_anomalous` | % of window samples flagged anomalous — separates *sustained* from *transient* |
| `distance_frozen` | Zero-variance distance across ≥ 3 samples (dead sensor while moving) |
| `max_distance_jump` | Largest step change between adjacent readings (discontinuity detection) |

This is what lets the system distinguish a **transient spike** (one bad sample) from a
**sustained condition** (a real mechanical problem), and it is the reason the investigation
loop asks for more data before committing to a diagnosis.

### 4. Classifier — physical fault signatures

`models/ml/classify.py`

`classify(processed, window)` scores each fault signature and returns them ranked, with
`matched_conditions` and `contradicting` evidence strings for each. Anything scoring ≤ 0.30
is discarded, and if nothing survives the result is a synthetic `healthy` match.

| Fault | Physical meaning | Key discriminator |
|---|---|---|
| `mechanical_drag` | Friction in bearings, axles, or drivetrain | Current/RPM ratio ≥ 30 % above bucket baseline **and the wheel is still turning** |
| `obstruction_jam` | Drivetrain lockup / stall | Current z ≥ 3.0 **and** RPM physically at/below stall threshold **and** clear path ahead |
| `sensor_fault` | Ultrasonic sensor failure | Out-of-range, frozen while moving, or a > 150 cm step jump |
| `motor_mismatch` | Dual-motor asymmetry | ≥ 25 % left/right disparity (requires per-wheel fields; skipped on single-motor cars) |

The critical design decision is the **stall threshold**:

```python
stall_rpm_threshold = max(20.0, baseline_rpm_mean * 0.15)
```

Drag and jam both depress RPM and both raise current — a z-score alone cannot tell them apart,
because drag's elevated current *also* drives RPM far from baseline. The physical guard is
that a wheel which is not turning is jammed, not dragging. Everything downstream (scores,
preliminary diagnosis, the LLM's system prompt, the fallback path) keys off this one
distinction.

Scores used by the backend's fast path: `obstruction_jam` = 0.95–0.98, `mechanical_drag` =
0.65–0.98 scaled by elevation, `sensor_fault` = 0.85–0.96.

### 5. Pipeline — the `analyze()` / `build_evidence()` facade

`models/ml/pipeline.py`

```python
analysis = analyze(raw=reading, recent_window=last_20, reference=REFERENCE)
# -> {"processed": {...}, "matches": [...], "is_anomaly": bool}
```

One call that chains the whole statistical layer. The backend uses exactly this — there is no
parallel path through the detector.

`build_evidence(raw, processed, matches, window)` then distills everything into a **compact,
high-density** payload deliberately capped near ~1500 characters, because it has to fit a
constrained local model context (a 7B on 8 GB RAM) alongside the system prompt and the
investigation history:

```json
{
  "car_id": "car-01", "mode": "forward", "pwm": 200, "bucket": "forward:200",
  "telemetry": { "current_a": 6.0, "current_baseline": 1.75, "current_z": 53.12,
                 "rpm": 20.0, "rpm_baseline": 303.2, "rpm_z": -35.62,
                 "ratio": 0.3, "ratio_baseline": 0.0058,
                 "distance_cm": 85.0, "distance_plausible": true },
  "anomaly":  { "is_anomaly": true, "score": 53.12, "reasons": ["…"] },
  "top_matches": [ { "fault": "obstruction_jam", "score": 0.95, "matched": ["…"] } ],
  "window_stats": { "samples": 20, "current_mean": 2.7, "rpm_mean": 210.0,
                    "pct_anomalous": 100.0, "current_slope": 0.002, "rpm_slope": -0.05 }
}
```

`window_stats` is only present when a window is supplied. Only the top 2 matches and top 2
reasons are included — the rest is trimmed deliberately.

### 6. Reasoner — local LLM + deterministic fallback

`models/ml/reasoner.py`

**`reason(evidence, history, model=None, ollama_url=None, timeout=None)`**

POSTs to `{OLLAMA_URL}/api/chat` with:

- `format` = a JSON schema constraining the response — Ollama enforces this grammatically, so
  malformed JSON is largely prevented at generation time rather than parsed out afterwards
- `options`: `temperature: 0` (deterministic), `repeat_penalty: 1.15`, `num_ctx: 2048`,
  `num_predict: 200`
- `keep_alive: "30m"` so the model stays resident between investigations
- A system prompt auto-generated from `FAULT_SIGNATURES` plus three few-shot examples
  (jam, ambiguous, sensor fault)

The response is then validated (`_validate_response_schema`), normalized
(`_normalize_output`), and returned. Normalization **computes in code** what the model was not
asked to produce: `evidence_used` (from matched conditions), `severity` (from fault type and
confidence), and `ui_hints` (which metrics and charts the dashboard should highlight). The LLM
never gets to invent those.

**Failure handling** — every path is covered, and all of them return a fully-formed diagnosis:

| Failure | Behaviour |
|---|---|
| Ollama unreachable | `reason_fallback(error_note="Ollama connection failed")` |
| Timeout | `reason_fallback(error_note="Ollama timed out (Xs)")` |
| HTTP ≠ 200 | `reason_fallback(error_note="Ollama HTTP <code>")` |
| Malformed JSON / schema violation | One retry with a stricter corrective user message, then `reason_fallback` |
| Unexpected exception | `reason_fallback(error_note="LLM error: <Type>")` |

**`reason_fallback(evidence, history, error_note, stage)`** — a deterministic, rule-driven
diagnosis generator. It reads the top rule match, maps the fault type to a canonical diagnosis
string, severity, recommended action, and UI hints, and stamps `confidence` with the *actual
rule score*. It is not a placeholder: it is the same output shape with the same semantics,
produced without a model. It is also used deliberately for the **preliminary** stage (see
below), so the fallback path is exercised in normal operation and not just during outages.

**`reason()` output contract** (also the `investigation_step` / `diagnosis` payload schema):

```json
{
  "action": "diagnose" | "request_more_data",
  "reasoning": "one sentence, ≤ 30 words",
  "diagnosis": "string | null",
  "confidence": 0.0–1.0 | null,
  "evidence_used": ["…"],
  "recommended_action": "string | null",
  "more_data": { "seconds": 1–5, "focus": "current" | "rpm" | "distance" } | null,
  "severity": "info" | "warning" | "critical",
  "ui_hints": { "highlight_metrics": ["…"], "suggested_charts": ["…"] },
  "stage": "preliminary" | "final"
}
```

### 7. Backend — ingestion, investigation loop, broadcast

`backend/main.py` (546 lines)

#### Ingestion — `ws://…/telemetry/ingest`

Per frame, synchronously and without blocking:

1. Stamp `_seq` (monotonic counter) and fill a missing `timestamp` with `time.time()`
2. Append to a 300-deep in-memory `rolling_buffer`
3. `INSERT` into `raw_telemetry`
4. `analyze(raw, recent_window=rolling_buffer[-20:], reference=REFERENCE)`
5. `INSERT` into `processed_telemetry`
6. `broadcast("processed", …)`
7. Update the consecutive-anomaly counter; if `≥ 3` and not already investigating and the
   cooldown has elapsed, **fire-and-forget** `asyncio.create_task(trigger_investigation(...))`

Step 7 never blocks the socket. The LLM runs in a thread executor
(`loop.run_in_executor`) so the event loop keeps accepting telemetry while a 20-second
inference is in flight. There is an integration test asserting ingestion stays under ~50 ms
while a 300 ms reasoning task runs.

#### Investigation loop — `trigger_investigation(reading, processed, result)`

```
single-flight guard (is_investigating)  →  cooldown guard  →  asyncio.Lock
  │
  ├─ trace_id = uuid4(), history = []
  │
  ├─ [1] PRELIMINARY DIAGNOSIS  (immediate, < 2 ms)
  │      reasoner.reason_fallback(stage="preliminary")
  │      → INSERT investigations(step_type="diagnosis")
  │      → broadcast("diagnosis", …)              ← dashboard paints something instantly
  │
  ├─ [2] decide depth: decisive rule match (top ≥ 0.85, margin ≥ 0.15) → 1 hop
  │                        otherwise                                    → 3 hops
  │
  └─ loop (≤ 3):
        reason_fn(evidence, history)   in executor
        │
        ├─ action == "diagnose"
        │    stage = "final"  →  INSERT  →  broadcast("diagnosis", …)  →  return
        │
        └─ action == "request_more_data"
             INSERT step_type="reasoning"  →  broadcast("investigation_step", …)
             history.append(result)
             new_readings = await collect_window(seconds=more_data.seconds)
             window_stats = process_window(new_readings, REFERENCE)
             evidence     = build_evidence(latest_raw, latest_processed,
                                           classify(latest_processed, window_stats),
                                           window_stats)
             continue     ← loop with genuinely fresher evidence

  loop exhausted:
    top rule score ≥ 0.50 → reason_fallback(stage="final") with the concrete reason
    otherwise              → structured `inconclusive` diagnosis
```

This is the heart of the "agentic" behaviour: **the reasoner can ask for more data, and the
system actually goes and gets it.** `collect_window()` waits the requested interval while
ingestion keeps running, then returns the readings that arrived after the request began
(falling back to the last 20 buffered samples if the stream paused). The evidence is then
re-derived from scratch against that window. A real LLM that sees only a single ambiguous
sample genuinely cannot distinguish a spike from a sustained condition; giving it the
temporal window is what makes its answer trustworthy.

#### Progressive diagnosis

The preliminary/final split exists because a 7B model on consumer hardware can take
**10–30 seconds** to answer. Emitting a rule-derived diagnosis immediately and refining it
later means the operator sees a verdict in milliseconds and a better verdict seconds after.
The dashboard keys off `stage` in the payload.

#### Broadcast — `ws://…/ws`

Every event uses one envelope: the payload is available **both** nested under `data` and
flattened at the top level. This is intentional backward compatibility — it means a client
can read `msg.is_anomaly` or `msg.data.is_anomaly` and both work.

```json
{ "type": "<event>", "event": "<event>", "data": { …payload… }, …payload… }
```

Dead connections are pruned on send failure.

#### Concurrency controls

- `investigation_lock` (`asyncio.Lock`) + `is_investigating` flag → strict single-flight, so a
  second anomaly cannot start a second investigation
- `INVESTIGATION_COOLDOWN_SECONDS` between investigations
- `consecutive_anomalies ≥ 3` debounce before a single anomalous sample triggers anything

---

## Data Model

SQLite, at `backend/telemetry.db`. Schema is created by `init_db()` in `backend/db.py`, which
runs **at import time**, and it performs additive column migrations so older databases keep
working.

### `raw_telemetry`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `timestamp` | REAL | Epoch seconds; nullable if the sender omitted it |
| `car_id` | TEXT | |
| `distance_cm` | REAL | |
| `current_a` | REAL | |
| `rpm` | REAL | |
| `pwm_command` | INTEGER | |
| `mode` | TEXT | |

### `processed_telemetry`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `raw_id` | INTEGER | FK → `raw_telemetry.id` |
| `timestamp` | REAL | |
| `current_rpm_ratio` | REAL | `current_a / max(rpm, 1)` |
| `current_zscore` | REAL | |
| `rpm_zscore` | REAL | |
| `mahalanobis_distance` | REAL | The anomaly score |
| `distance_plausible` | INTEGER | 0/1 — *added by migration* |
| `bucket_used` | TEXT | e.g. `forward:200` — *added by migration* |
| `is_anomaly` | INTEGER | 0/1 — *added by migration* |

### `investigations`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `trace_id` | TEXT | UUIDv4 grouping all steps of one investigation |
| `timestamp` | REAL | |
| `step_type` | TEXT | `reasoning` \| `diagnosis` |
| `payload` | TEXT | JSON **string** of a `reason()` result |

The double-encoded `payload` (a JSON string inside a JSON envelope) is a deliberate,
documented part of the wire contract — clients call `JSON.parse(data.payload)`. See
[`backend/README.md`](backend/README.md).

---

## API Reference

### WebSocket — ingest (producer → backend)

```
ws://localhost:8000/telemetry/ingest
```

```json
{
  "car_id": "car-01",
  "timestamp": 1790517076.141,
  "distance_cm": 85.0,
  "current_a": 1.75,
  "rpm": 305.0,
  "pwm_command": 200,
  "mode": "forward"
}
```

`timestamp` may be omitted (the backend fills it). Unknown extra keys are ignored.

### WebSocket — broadcast (backend → dashboard)

```
ws://localhost:8000/ws
```

#### `processed` — after every reading

```json
{
  "type": "processed", "event": "processed",
  "data": {
    "raw_id": 42, "timestamp": 1790529918.0,
    "current_rpm_ratio": 0.0057, "current_zscore": -0.11, "rpm_zscore": 0.21,
    "mahalanobis_distance": 0.23, "distance_plausible": 1,
    "bucket_used": "forward:200", "is_anomaly": 0, "id": 17
  }
}
```

#### `investigation_step` — each reasoning hop

`data.payload` is a **JSON string**; parse it.

```json
{
  "type": "investigation_step", "event": "investigation_step",
  "data": {
    "trace_id": "b4990b22-…", "timestamp": 1790530086.0, "step_type": "reasoning",
    "payload": "{\"action\":\"request_more_data\",\"reasoning\":\"…\",\"more_data\":{\"seconds\":2,\"focus\":\"current\"},…}"
  }
}
```

#### `diagnosis` — terminal (or preliminary) verdict

Same shape with `step_type: "diagnosis"`. `stage` inside the payload distinguishes
`"preliminary"` (instant, rule-derived) from `"final"` (LLM-refined or fallback-resolved).

The `inconclusive` outcome carries **both** the structured `payload` string (so every client
path works) and the flattened legacy `diagnosis` / `reason` top-level keys.

### REST

| Endpoint | Params | Returns |
|---|---|---|
| `GET /health` | — | `{"status":"ok"}` |
| `GET /api/telemetry` | `since` (epoch), `limit` (1–1000, default 100), `downsample` (1–100, default 1) | Raw ⋈ processed history, chronological |
| `GET /api/investigations` | `limit` (1–200, default 50) | Traces grouped by `trace_id` with start/complete times, step count, final diagnosis |
| `GET /api/investigations/{trace_id}` | — | Full chronological step trace (404 if unknown) |
| `GET /api/status` | — | LLM reachability, active model, fallback flag, investigation state, cooldown, buffer size, DB row counts |

```json
// GET /api/status
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
  "db_row_counts": { "raw_telemetry": 4313, "processed_telemetry": 4313, "investigations": 129 }
}
```

Interactive API docs are available at `/docs` while the server is running.

---

## Configuration

All configuration is environment variables. No config file, no secrets in the repo.

| Variable | Default | Purpose |
|---|---|---|
| `MACHSIGHT_LLM_MODEL` | `qwen2.5:7b-instruct` | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `MACHSIGHT_LLM_TIMEOUT` | `45` | Per-request LLM timeout, seconds |
| `MACHSIGHT_USE_STUB` | `0` | `1` forces the rule-only stub reasoner (no LLM) |
| `MACHSIGHT_CONSECUTIVE_ANOMALIES` | `3` | Consecutive anomalous readings required to open an investigation |
| `MACHSIGHT_INVESTIGATION_COOLDOWN` | `15.0` | Minimum seconds between investigations |
| `MACHSIGHT_HOST` | `localhost` | Demo launcher bind host |
| `MACHSIGHT_PORT` | `8000` | Demo launcher port |
| `VENV_DIR` | `.venv` | Virtualenv the demo launcher should use |

> **Note:** the startup warmup in `backend/main.py` currently defaults to `qwen2.5:3b-instruct`
> while the reasoner defaults to `qwen2.5:7b-instruct`. Set `MACHSIGHT_LLM_MODEL` explicitly to
> keep them aligned (see [Known Gaps](#known-gaps--technical-debt)).

---

## Getting Started

### Prerequisites

- Python 3.10+ (developed and tested on 3.12)
- Node.js 18+ (frontend only)
- [Ollama](https://ollama.com) — **optional**; the system runs fully on rule-based fallback

### 1. Backend

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
```

The baseline `models/ml/reference.pkl` is committed, so there is nothing to train. To rebuild
it, see [Reference Builder](#1-reference-builder--the-healthy-baseline).

### 2. Run

```bash
# From the repo root
uvicorn backend.main:app --reload
# or
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Verify:

```bash
curl -s http://localhost:8000/health
curl -s http://localhost:8000/api/status | python3 -m json.tool
```

### 3. Ollama (optional but recommended)

```bash
ollama serve
ollama pull qwen2.5:7b-instruct        # or qwen2.5:3b-instruct for 8 GB machines
```

If you skip this, set `MACHSIGHT_USE_STUB=1` or simply let the fallback handle it — the system
never fails, it just gets less articulate.

### 4. Feed it telemetry

```bash
# Terminal 1 — watch the live event stream
python -c "
import asyncio, websockets, json
async def watch():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        while True:
            m = json.loads(await ws.recv())
            print(f\"{m['type']:20s} {json.dumps(m.get('data', {}))[:140]}\")
asyncio.run(watch())
"

# Terminal 2 — healthy for 5s, then mechanical drag for 25s at 10 Hz
python scripts/mock_car.py --fault drag --duration 30 --start-fault-after 5 --verbose

# Other faults
python scripts/mock_car.py --fault jam --duration 20 --start-fault-after 3
python scripts/mock_car.py --fault sensor_fault --duration 20 --start-fault-after 5
```

You should see `processed` events, then a `diagnosis` with `stage: "preliminary"` almost
immediately, then a refined `diagnosis` with `stage: "final"` once the LLM returns.

### 5. Frontend

```bash
cd frontend
npm install
npm run dev
```

**Important:** the dashboard currently does **not** connect to the backend. See
[Frontend Status](#frontend-status).

### 5. Or just run the guided demo

```bash
bash scripts/run_demo.sh                          # preflight checks + start backend + print the demo
bash scripts/run_demo.sh --skip-ollama-check      # rule-only mode
bash scripts/run_demo.sh --model qwen2.5:3b-instruct
```

---

## Testing

```bash
source .venv/bin/activate

# Everything (39 tests, ~5 s)
python -m pytest models/ml/ backend/ scripts/test_e2e_mock_car.py -q

# By area
python -m pytest models/ml/test_detector.py -q               # statistical detector
python -m pytest models/ml/test_features_classification.py -q # features + classifier + evidence
python -m pytest models/ml/test_reasoner.py -q               # LLM client + all fallback paths
python -m pytest backend/test_backend.py -q                  # investigation loop + REST + latency
python -m pytest scripts/test_e2e_mock_car.py -q             # E2E with mocked LLM
```

**Current status: 39 passed.**

| Suite | Covers |
|---|---|
| `test_detector.py` | Reference construction, healthy/fault scoring, nearest-PWM fallback, low-sample z-score fallback, sensor plausibility |
| `test_features_classification.py` | `process_reading`/`process_window` contracts, drag/jam/sensor classification, single- vs dual-motor mismatch, `build_evidence` size budget (< 1500 chars) |
| `test_reasoner.py` | Valid/invalid LLM responses, malformed-JSON retry, timeout / connection / HTTP-500 fallbacks, required-key guarantee on every path, history summarization |
| `test_backend.py` | Single-flight + debounce + cooldown, `request_more_data` window collection, inconclusive payload shape, ingestion latency under load, all REST endpoints |
| `test_e2e_mock_car.py` | drag → drag diagnosis, jam → jam, sensor_fault → sensor, healthy → no investigation, evidence field content |

Frontend:

```bash
cd frontend && npm run build     # tsc typecheck + vite build
```

### Performance measurement

```bash
# LLM latency / throughput in isolation
python scripts/bench_llm.py

# Full pipeline latency against a live backend + Ollama
python scripts/e2e_timing.py
```

`e2e_timing.py` reports fault onset → first anomaly → preliminary diagnosis → final diagnosis,
which is the number that actually matters for the UX.

---

## Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/mock_car.py` | Stateful RC car simulator. Healthy phase, then a chosen fault. Baselines are hardcoded to mirror `reference.pkl`. |
| `scripts/replay.py` | Replay a `.db` or `.csv` trace at original or scaled timing (`--speed 4`). |
| `scripts/bench_llm.py` | 3-pass Ollama benchmark: cold load, warm latency, tokens/sec. Warns if warm latency > 20 s. |
| `scripts/e2e_timing.py` | Real end-to-end timing pass against a live backend. |
| `scripts/test_e2e_mock_car.py` | pytest E2E with a deterministic mocked LLM. |
| `scripts/send_test.py` / `send_anomaly.py` | One-shot healthy / anomalous frames for quick manual checks. |
| `scripts/run_demo.sh` | Preflight (Python, deps, `reference.pkl`, Ollama) → start backend → print the demo command sequence. |
| `models/ml/mock_data_generator.py` | Generate synthetic healthy or fault-injected telemetry CSVs (used heavily by the tests). |

### Mock car fault signatures

| Fault | Signature | Detected as |
|---|---|---|
| `none` | Baseline ± 2σ Gaussian noise, slowly drifting distance | `healthy` |
| `drag` | Current +55 % above baseline, RPM −32 %, ramped in over ~10 samples, path clear | `mechanical_drag` |
| `jam` | Current 5–7 A, RPM ≈ 5, distance frozen ≥ 45 cm (internal jam, not a wall) | `obstruction_jam` |
| `sensor_fault` | Motor healthy; distance frozen at one value **or** out of range (< 2 cm / > 400 cm) | `sensor_fault` |

---

## Frontend Status

**The frontend builds and type-checks cleanly, but it is not connected to the backend.**

`frontend/IndustrialDoctor.tsx` is a ~1900-line, self-contained React component that simulates
industrial rotating machinery — turbines, extruders, pumps — with `bearingTemp`,
`vibrationRms`, `hydraulicPressure`, `acousticEmission`, `powerDraw`, and `oilViscosity`.
None of those fields exist in the MachSight telemetry schema.

Concretely:

- **No WebSocket, no `fetch`, no API calls of any kind.** Telemetry is generated locally by a
  `setInterval` loop with `Math.random()` jitter, so every reload shows different data.
- `apiEndpoint` defaults to `ws://scada-broker.lan:8080/v1/telemetry` and is editable in the
  IO config modal — but the value is only ever passed to an `alert()`. It never connects.
- The FFT spectrum plot and the defect-frequency table are hardcoded literals that do not
  respond to machine selection or live data.
- The "AI audit" button fabricates a `DiagnosticFinding` from a template after a 1200 ms
  `setTimeout`.
- Landing KPIs, the fleet health score, and the footer UTC clock are frozen constants.

What is genuinely useful and worth keeping:

- The **visual language**: a dense, dark-mode, monospace SCADA aesthetic with a sticky header,
  a tab structure (`LANDING | OVERVIEW | INSIGHTS | DIAGNOSTICS | LOGS`), a telemetry table
  with per-channel sparklines, a severity-filtered log console, and a diagnostics dossier
  layout that renders a finding as *severity + confidence + root-cause mechanism + evidence
  bullets + recommended action + workflow status*.
- The `DiagnosticFinding` shape maps almost directly onto MachSight's diagnosis payload
  (`severity`, `confidence`, `diagnosis` → root cause, `evidence_used` → evidence bullets,
  `recommended_action`, plus an `ui_hints` contract already defined in the reasoner).
- Hand-rolled SVG sparklines with min/max guides and last-value deltas — no chart library
  dependency, which is a reasonable constraint for an offline tool.

**Connecting it is the single highest-impact piece of remaining work** — see
[Future Work](#future-work--roadmap).

Tech stack: React 19, TypeScript, Vite 8, Tailwind via CDN. Runtime dependencies are only
`react` and `react-dom`; there is no chart, state, or UI library.

---

## Design Decisions & Invariants

Things that are load-bearing and should be preserved in any refactor:

1. **Conditioning on `(mode, pwm_command)` is not optional.** A single global baseline would
   generate constant false positives. This is the core of the detection model.
2. **The envelope is duplicated on purpose.** `data.*` *and* flattened top-level keys exist for
   backward compatibility with existing consumers. Do not "clean this up" without a migration.
3. **`payload` is a JSON string inside a JSON envelope.** Documented, tested, and depended on
   by every client. Changing it is a breaking protocol change.
4. **The LLM is never on the critical path.** It runs in an executor, is bounded by a timeout,
   retries at most once, and every failure resolves to a rule-derived diagnosis. Removing the
   LLM must degrade the *prose*, not the *function*.
5. **Derived fields (`evidence_used`, `severity`, `ui_hints`) are computed in code**, not
   requested from the model. The model writes narrative text; deterministic code owns
   structured facts. This keeps the UI contract stable regardless of model behaviour.
6. **Reasoning never blocks ingestion.** Verified by an integration test asserting < 50 ms
   ingestion while a 300 ms reasoning task runs.
7. **Ingestion is the only writer to the hot tables**, and it commits per reading, so the
   dashboard's REST history is always consistent with the live stream.
8. **The stall threshold is the drag/jam discriminator.** `max(20.0, 0.15 × baseline_rpm)`.
   Everything in the classifier, the reasoner prompt, and the fallback depends on it.
9. **The detector is the ground-truth anomaly flag.** `analyze()` sources `is_anomaly` directly
   from `score_reading()`. The classifier ranks *causes*; it never decides *whether* something
   is wrong.

---

## Known Gaps & Technical Debt

Ordered roughly by impact.

### Functional

1. **Frontend is entirely disconnected from the backend.** No WS client, wrong domain model,
   simulated data. Blocks any real demo of the product.
2. **The "decisive match" fast path in `trigger_investigation()` is effectively dead code.**
   `backend/main.py:208` reads the module-global `consecutive_anomalies`, but
   `backend/main.py:403` resets that counter to `0` immediately before
   `asyncio.create_task(trigger_investigation(...))` runs. So
   `consecutive_anomalies >= 3` is never true, `allow_more_data` is always `True`, and
   `max_loops` is always 3 — the intended single-hop shortcut for confident diagnoses never
   fires. Fix by capturing the count before the reset and passing it as a parameter.
3. **`ml_stub.reason()` returns an under-specified payload** — `{action, diagnosis, confidence}`
   only, with no `reasoning`, `severity`, `ui_hints`, or `evidence_used`. In stub mode the
   emitted diagnosis does not satisfy the documented event contract. It should delegate to
   `reasoner.reason_fallback()`.
4. **Warmup model mismatch.** `warmup_ollama()` defaults to `qwen2.5:3b-instruct` while
   `reasoner.reason` defaults to `qwen2.5:7b-instruct`, so the first investigation pays a
   second cold load. Both should read the same resolved model.
5. **`motor_mismatch` is unreachable.** The classifier needs per-wheel fields
   (`rpm_left`/`rpm_right`/…), but neither the schema, the ingest path, nor the DB has them.
   It is scaffolding for a dual-motor chassis.
6. **No pagination or retention policy on SQLite.** `raw_telemetry` grows unbounded
   (4,313 rows in the current dev DB) and `/api/telemetry` has no cursor — only `limit`.
   Needs an index on `(car_id, timestamp)`, a time-window API, and a retention/rollup job.

### Correctness / robustness

7. **`active_connections` is mutated without a lock** (`backend/main.py:88-93`). Safe in
   practice on a single event loop, but fragile — a lock or `set` would be more defensive.
8. **`init_db()` runs at import time**, not in a FastAPI lifespan handler. It works, but it
   means the schema is created as a side effect of importing `db`, and the `@app.on_event`
   deprecation warning is emitted twice on startup.
9. **Single SQLite connection shared across all requests** with `check_same_thread=False` and a
   commit per insert. Fine for one process at 10 Hz; it will not survive multi-worker uvicorn
   or higher rates. Move to a connection pool or `aiosqlite` before scaling.
10. **No ingestion-side validation.** Malformed frames, wrong types, or a `mode` outside the
    enum are passed straight through to the numeric layer. A Pydantic model on the ingest path
    would reject bad input and produce a proper error event.
11. **No authentication or transport security on any endpoint.** `ws://` and `http://` only —
    fine for a bench demo, not for anything else.
12. **`reference.pkl` is a pickle loaded at import time.** Convenient, but a build artifact
    committed to git and unpickled without verification. A JSON/NPZ format would be portable,
    diffable, and safe.

### Testing & observability

13. **The E2E tests mock the LLM**, so the actual model output quality is never asserted. There
    is no regression test for "does qwen2.5 actually return a usable diagnosis?".
14. **`scripts/test_e2e_mock_car.py` has a vestigial helper.** `_pump_readings_through_backend()`
    builds a `broadcasted` list and returns it empty — the capture function is defined but
    never wired up.
15. **No frontend tests at all** — no Vitest, no React Testing Library.
16. **Logging is minimal and mostly ad-hoc** (`logger.warning` / `logger.error` with f-strings).
    No structured logging, no request IDs, no metrics export. `e2e_timing.py` is the only
    performance instrumentation, and it is a script rather than a service.
17. **No CI.** Nothing runs the tests or the build automatically on commit.

### Housekeeping

18. **Dead/orphan files:** `backend/machsight.db` (0 bytes, referenced nowhere),
    `.DS_Store` files at the repo root and in `models/`, and `scripts/__pycache__/` containing
    a stale `send_test.cpython-312-pytest-9.1.1.pyc`.
19. **Root `.gitignore` ignores `*.db` but not `.pytest_cache/`**, and `docs/CONTEXT.md` has
    drifted from the implementation in several places (it still describes `MAX_LOOPS`,
    a missing `collect_window()`, and an inconclusive event without a payload — all of which
    have since been fixed in code).

---

## Future Work / Roadmap

Ordered by expected value.

### Near term — make the product demonstrable

1. **Connect the frontend to the backend.** Replace the `setInterval` simulator with a
   `WebSocket` client against `/ws`; map `processed` events onto the existing sparkline/table
   layout; render `investigation_step` as a live reasoning trace; render `diagnosis` (both
   `preliminary` and `final`) into the existing dossier component. Use the reasoner's
   `ui_hints.highlight_metrics` / `suggested_charts` to drive the presentation — the contract
   was designed for exactly this and is currently unused. Backfill history from
   `GET /api/telemetry` and investigation history from `GET /api/investigations`. Add a Vite
   dev proxy for `/ws` and `/api` so there is no CORS configuration.
2. **Fix the decisive fast-path bug** (#2 above) — one line, and it removes a wasted LLM round
   trip on confident diagnoses.
3. **Make `ml_stub` contract-complete** by delegating to `reasoner.reason_fallback()`.
4. **Align the warmup model default** with the reasoner default.
5. **Add Pydantic validation on the ingest path**, and emit an `error` event for rejected
   frames instead of silently coercing.

### Medium term — quality and scale

6. **Real LLM regression tests.** A small golden-file suite that runs the live model against a
   fixed evidence set and asserts the diagnosis is semantically correct. This is what protects
   against a prompt or model change silently degrading output quality. Run it on a schedule or
   a separate CI job rather than in the unit-test path.
7. **Multi-vehicle support.** `car_id` is stored everywhere but every state variable in
   `backend/main.py` (counters, cooldowns, investigation flags) is global. Partitioning by
   `car_id` is a prerequisite for anything beyond a single car.
8. **Better conditioning.** Mahalanobis over 2 dimensions is thin. Adding load/temperature
   context, or extending the covariance to include a third dimension, would make the
   multivariate metric meaningfully multivariate.
9. **Persistence for state.** Investigation counters and cooldowns live in module globals and
   reset on restart, and a crash loses in-flight work. Move to a small state store or write
   through to SQLite.
10. **Database scale.** Index `(car_id, timestamp)`, add cursor pagination, introduce a
    downsampled rollup table for long-range charting, and add a retention job. Consider
    TimescaleDB or plain PostgreSQL if this graduates past a bench tool.
11. **Concurrent upload safety.** Move off the single shared SQLite connection
    (`aiosqlite` or a pool) so the backend can run multi-worker and survive real load.
12. **Frontend hardening.** Replace the Tailwind CDN with a real build, split the 1900-line
    component into modules, and add Vitest coverage for the WebSocket client and reducers.

### Longer term — capability

13. **Complete the dual-motor story.** Add per-wheel current/RPM channels to the schema,
    storage, and detector; `motor_mismatch` then becomes live. This is the main argument for
    the `chassis` being part of the reference bucket key.
14. **More fault signatures.** Battery/voltage sag, encoder or tachometer faults, thermal
    runaway, and controller faults are all detectable with small schema extensions. Each is a
    new entry in `FAULT_SIGNATURES` plus a rule block in `classify()` — the architecture
    already accommodates this.
15. **Learned baselines.** The current baseline is one CSV and a pickle. A periodic retraining
    job that re-derives buckets from confirmed-healthy production data would let the model
    adapt to hardware wear, battery age, and ambient temperature. The bucketed design is
    already the right shape for this.
16. **Tighter LLM integration.** Streaming the final diagnosis token-by-token, adding a
    retrieval step over historical investigations with the same `trace_id` fingerprint, and
    allowing the reasoner to request a *specific mode/PWM sweep* rather than just a time
    window.
17. **Fleet dashboard.** Multi-car views, a live fault map, and cross-vehicle correlation —
    natural once #7 and #10 land.
18. **Real hardware integration.** An ESP32/Arduino bridge to the vehicle speaking
    `/telemetry/ingest` over WebSocket. Everything downstream already works; only the producer
    is simulated.
19. **Observability and alerting.** Structured logging with `trace_id` propagation,
    Prometheus metrics (ingest rate, anomaly rate, LLM latency, fallback rate), and a
    notification path when a `critical` diagnosis is emitted.
20. **Security and deployment.** Authentication, TLS, per-vehicle API keys, and a proper
    containerized deployment. The current plaintext `ws://` posture is appropriate only for
    a local bench.

---

## Datasets

| Path | Contents | Used by |
|---|---|---|
| `models/ml/healthy_telemetry.csv` | 600 healthy samples, 50 per bucket across 12 `(mode, pwm)` buckets | Source for `reference.pkl` |
| `dataset/mcsadc-motor-rotorbarfailure-1_2023/` | 162 CSVs of real motor rotor-bar failure vibration/current waveforms | **Not yet integrated** — potential future source of realistic fault data |
| `dataset/eletric_motor_temp_measures_v2.csv` | Electric motor thermal/electromagnetic measurements (`u_q`, `i_d`, `i_q`, winding/stator/yoke temps, torque, `profile_id`) | **Not yet integrated** — same |

The two `dataset/` corpora are real industrial motor measurements and are the most promising
route to validating the detector against genuine failure signatures rather than synthetic ones.
Neither is referenced by any code path today. `dataset/eletric_motor_temp_measures_v2.csv` is
gitignored; the MCSADC directory is tracked.

---

## License

Declared as ISC in `frontend/package.json`. No root `LICENSE` file is present — one should be
added before any distribution.

## Acknowledgements

Built as a staged implementation; `git log` records the progression from scaffold → schema →
detector → investigation loop → LLM reasoning → fault-classifier fixup.
