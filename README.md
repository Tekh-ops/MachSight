# MachSight

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Test Coverage](https://img.shields.io/badge/coverage-39%20tests-blue)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Node](https://img.shields.io/badge/node-18%2B-green)
![License](https://img.shields.io/badge/license-ISC-orange)

**Real-time AI diagnostics for instrumented industrial machinery.**

MachSight is an edge-local diagnostic system that ingests high-frequency telemetry from RC vehicles and industrial equipment, scores every sample against conditioned healthy baselines using multivariate statistics, classifies physical fault signatures, and leverages a local LLM to produce human-readable diagnoses and recommended actions. Everything runs on a single machine, offline, with no cloud dependency — making it ideal for industrial environments where connectivity is unreliable or security is paramount.

## Table of Contents

- [Context & Overview](#context--overview)
- [Architecture & System Design](#architecture--system-design)
- [Installation & Configuration](#installation--configuration)
- [Developer Experience & Quality Control](#developer-experience--quality-control)
- [Reliability, Performance & Security](#reliability-performance--security)
- [Governance & License](#governance--license)

---

## Context & Overview

### Value Proposition

MachSight addresses the critical need for real-time, autonomous fault detection in industrial machinery and autonomous systems. Traditional monitoring systems either:

1. **Stream raw data to the cloud** — introducing latency, privacy risks, and single points of failure
2. **Use simple threshold alarms** — which generate constant false positives and miss subtle, multivariate fault patterns
3. **Require expert human operators** — to interpret complex telemetry and diagnose issues

MachSight solves these problems by:

- **Running entirely at the edge** — no cloud dependency, works offline, minimal latency
- **Using conditioned statistical baselines** — multivariate anomaly detection that accounts for operating context (mode, load, environmental conditions)
- **Providing autonomous multi-hop reasoning** — the system can request additional data when uncertain, then refine its diagnosis
- **Delivering human-readable diagnoses** — local LLM explains *what* is wrong, *why*, and *what to do* in natural language
- **Graceful degradation** — every LLM failure mode resolves to a deterministic, rule-based diagnosis

### Target Audience

- **Industrial operators** monitoring rotating machinery (motors, pumps, compressors, turbines)
- **Autonomous vehicle developers** needing onboard fault detection without cloud dependence
- **Maintenance teams** requiring predictive diagnostics and actionable repair guidance
- **Edge AI researchers** studying agentic reasoning with constrained compute resources

### Core Features

| Feature | Description |
|---|---|
| **Real-time telemetry ingestion** | WebSocket at 10 Hz+ per vehicle, JSON frames, sustained throughput |
| **Conditioned anomaly detection** | Mahalanobis distance over multivariate baselines bucketed by operating context |
| **Sensor plausibility checks** | Physical range validation and frozen-signal detection |
| **Window/temporal analysis** | Rolling statistics, trend detection, sustained vs. transient discrimination |
| **Fault classification** | Rule-based scoring of physical fault signatures with evidence trails |
| **Autonomous multi-hop reasoning** | LLM may request more data; system collects real telemetry window and re-reasons (≤ 3 hops) |
| **Progressive diagnosis** | Preliminary rule-based diagnosis in < 2 ms, refined by LLM seconds later |
| **Graceful degradation** | Every LLM failure resolves to deterministic rule-based diagnosis |
| **Full audit trail** | Every reading, feature, and reasoning step persisted in SQLite |
| **Dashboard API** | Live WebSocket broadcast + REST history/status endpoints |
| **Industrial data foundation** | Support for CWRU bearing, LIAS rotor bar, and Paderborn motor datasets |

### Demo Screenshots

![MachSight Dashboard](docs/screenshots/dashboard.png)
*Live telemetry dashboard with synchronized signal charts, diagnostic timeline, and AI-generated fault diagnosis*

![Diagnostic Panel](docs/screenshots/diagnosis.png)
*AI-powered diagnostic panel showing structured evidence, confidence scores, and recommended actions*

*For a live demo, see the [Installation](#installation--configuration) section below.*

---

## Architecture & System Design

### System Architecture

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

### End-to-End Execution Flow

1. **Telemetry Ingestion**
   - Vehicle sends JSON frames via WebSocket to `/telemetry/ingest`
   - Backend validates, timestamps, and stores in SQLite (`raw_telemetry`)
   - Each reading is scored against conditioned baselines using Mahalanobis distance
   - Processed data stored in `processed_telemetry` table
   - Results broadcast immediately via WebSocket to connected dashboards

2. **Anomaly Detection**
   - Readings are bucketed by `(mode, pwm_command)` for context-aware scoring
   - Multivariate analysis over `(current_a, rpm)` with z-score fallbacks
   - Sensor plausibility checks on ultrasonic distance
   - Consecutive anomaly counter (default: 3) triggers investigation

3. **Investigation Loop**
   - **Preliminary diagnosis** (< 2 ms): Rule-based fallback provides instant verdict
   - **Multi-hop reasoning** (if needed): LLM may request additional data window
   - System collects real telemetry for requested duration
   - Evidence re-derived from fresh window, LLM re-reasons
   - **Final diagnosis** (10-30 s): Refined verdict with natural language explanation

4. **Progressive Diagnosis**
   - Dashboard receives `stage: "preliminary"` immediately
   - Later receives `stage: "final"` with LLM refinement
   - UI highlights affected metrics and suggests charts via `ui_hints`

5. **Audit Trail**
   - All raw readings, processed features, and investigation steps persisted
   - REST API provides historical query (`/api/telemetry`, `/api/investigations`)
   - Full traceability for compliance and debugging

### Documentation Links

- **[Complete Architecture Documentation](ARCHITECTURE.md)** — Detailed system design, component interactions, and implementation details
- **[Backend API Documentation](backend/README.md)** — WebSocket contracts, REST endpoints, and event schemas
- **[Dataset Catalog](docs/DATASET_CATALOG.md)** — Supported industrial datasets and fault taxonomies
- **[Phase 5 Implementation Report](docs/PHASE_5.md)** — Industrial data foundation layer details
- **[Interactive API Docs](http://localhost:8000/docs)** — Available when backend is running (Swagger UI)

---

## Installation & Configuration

### Prerequisites & Tech Stack

| Component | Version | Notes |
|---|---|---|
| **Python** | ≥ 3.10 | Developed and tested on 3.12 |
| **Node.js** | ≥ 18 | Frontend only |
| **Ollama** | Latest | Optional; system runs on rule-based fallback if unavailable |
| **RAM** | 8 GB+ | Recommended for 7B model; 3B model works on 4 GB |
| **OS** | Linux/macOS/Windows | Cross-platform support |

**Tech Stack:**
- **Backend:** FastAPI, SQLite, NumPy, SciPy, Ollama
- **ML/Statistics:** NumPy, SciPy (multivariate analysis, no ML framework required)
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS
- **LLM:** Ollama (qwen2.5:7b-instruct or qwen2.5:3b-instruct)

### Step-by-Step Installation

#### 1. Clone Repository

```bash
git clone <repository-url>
cd MachSight
```

#### 2. Backend Setup

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt
```

The baseline `models/ml/reference.pkl` is committed, so no training is required. To rebuild it, see [Architecture Documentation](ARCHITECTURE.md#1-reference-builder--the-healthy-baseline).

#### 3. Ollama Setup (Optional but Recommended)

```bash
# Install Ollama (if not already installed)
# Visit https://ollama.com for platform-specific instructions

# Start Ollama service
ollama serve

# Pull model (7B for 8GB+ RAM, 3B for 4GB RAM)
ollama pull qwen2.5:7b-instruct  # or qwen2.5:3b-instruct
```

**Note:** If you skip Ollama, set `MACHSIGHT_USE_STUB=1` or the system will automatically use rule-based fallback.

#### 4. Frontend Setup

```bash
cd frontend
npm install
cd ..
```

#### 5. Run Backend

```bash
# From repository root
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Verify backend is running:

```bash
curl -s http://localhost:8000/health
curl -s http://localhost:8000/api/status | python3 -m json.tool
```

#### 6. Run Frontend

```bash
cd frontend
npm run dev
```

Access dashboard at `http://localhost:5173`

#### 7. Quick Demo with Mock Data

```bash
# Terminal 1 — Watch live event stream
python -c "
import asyncio, websockets, json
async def watch():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        while True:
            m = json.loads(await ws.recv())
            print(f\"{m['type']:20s} {json.dumps(m.get('data', {}))[:140]}\")
asyncio.run(watch())
"

# Terminal 2 — Send mock telemetry (healthy for 5s, then mechanical drag for 25s)
python scripts/mock_car.py --fault drag --duration 30 --start-fault-after 5 --verbose

# Other fault scenarios:
python scripts/mock_car.py --fault jam --duration 20 --start-fault-after 3
python scripts/mock_car.py --fault sensor_fault --duration 20 --start-fault-after 5
```

#### 8. Guided Demo Script

```bash
# Run preflight checks, start backend, and print demo commands
bash scripts/run_demo.sh

# Skip Ollama check (rule-only mode)
bash scripts/run_demo.sh --skip-ollama-check

# Use specific model
bash scripts/run_demo.sh --model qwen2.5:3b-instruct
```

### Environment Variables Matrix

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `MACHSIGHT_LLM_MODEL` | string | `qwen2.5:7b-instruct` | No | Ollama model name |
| `OLLAMA_URL` | string | `http://localhost:11434` | No | Ollama base URL |
| `MACHSIGHT_LLM_TIMEOUT` | integer | `45` | No | Per-request LLM timeout in seconds |
| `MACHSIGHT_USE_STUB` | integer | `0` | No | Set to `1` to force rule-only reasoner (no LLM) |
| `MACHSIGHT_CONSECUTIVE_ANOMALIES` | integer | `3` | No | Consecutive anomalous readings required to trigger investigation |
| `MACHSIGHT_INVESTIGATION_COOLDOWN` | float | `15.0` | No | Minimum seconds between investigations |
| `MACHSIGHT_HOST` | string | `localhost` | No | Demo launcher bind host |
| `MACHSIGHT_PORT` | integer | `8000` | No | Demo launcher port |
| `VENV_DIR` | string | `.venv` | No | Virtualenv path for demo launcher |

**Example `.env` file:**

```bash
MACHSIGHT_LLM_MODEL=qwen2.5:7b-instruct
OLLAMA_URL=http://localhost:11434
MACHSIGHT_LLM_TIMEOUT=45
MACHSIGHT_CONSECUTIVE_ANOMALIES=3
MACHSIGHT_INVESTIGATION_COOLDOWN=15.0
```

---

## Developer Experience & Quality Control

### Usage Snippets

#### Python Backend API

```python
import websockets
import json
import asyncio

async def send_telemetry():
    reading = {
        "car_id": "car-01",
        "timestamp": 1790517076.141,
        "distance_cm": 85.0,
        "current_a": 1.75,
        "rpm": 305.0,
        "pwm_command": 200,
        "mode": "forward"
    }
    async with websockets.connect('ws://localhost:8000/telemetry/ingest') as ws:
        await ws.send(json.dumps(reading))
        response = await ws.recv()
        print(f"Server response: {response}")

asyncio.run(send_telemetry())
```

#### WebSocket Client (Dashboard)

```typescript
import { useMachSightWebSocket } from './hooks/useMachSightWebSocket';

function Dashboard() {
  const {
    connectionState,
    latestTelemetry,
    latestDiagnosis,
    telemetryHistory,
    timelineEvents
  } = useMachSightWebSocket('ws://localhost:8000/ws');

  return (
    <div>
      <div>Connection: {connectionState}</div>
      <div>Current: {latestTelemetry?.current_a} A</div>
      <div>RPM: {latestTelemetry?.rpm}</div>
      <div>Diagnosis: {latestDiagnosis?.diagnosis}</div>
    </div>
  );
}
```

#### REST API Queries

```bash
# Get recent telemetry history
curl "http://localhost:8000/api/telemetry?limit=100"

# Get investigation history
curl "http://localhost:8000/api/investigations?limit=50"

# Get specific investigation trace
curl "http://localhost:8000/api/investigations/{trace_id}"

# Get system status
curl "http://localhost:8000/api/status"
```

### Testing & QA Commands

#### Backend Tests

```bash
source .venv/bin/activate

# Run all tests (39 tests, ~5 seconds)
python -m pytest models/ml/ backend/ scripts/test_e2e_mock_car.py -q

# Run specific test suites
python -m pytest models/ml/test_detector.py -q                 # Statistical detector
python -m pytest models/ml/test_features_classification.py -q  # Features + classifier
python -m pytest models/ml/test_reasoner.py -q                  # LLM client + fallback
python -m pytest backend/test_backend.py -q                     # Investigation loop + REST
python -m pytest scripts/test_e2e_mock_car.py -q                # E2E with mocked LLM
```

**Current test status:** 39 passed

| Suite | Coverage |
|---|---|
| `test_detector.py` | Reference construction, healthy/fault scoring, nearest-PWM fallback, sensor plausibility |
| `test_features_classification.py` | Process contracts, drag/jam/sensor classification, evidence budget |
| `test_reasoner.py` | LLM responses, timeout/connection fallbacks, history summarization |
| `test_backend.py` | Single-flight, debounce, cooldown, window collection, REST endpoints |
| `test_e2e_mock_car.py` | E2E fault injection with mocked LLM |

#### Frontend Tests

```bash
cd frontend

# Type check and build
npm run build

# Run tests (25 tests)
npm test
```

**Current test status:** 25 passed

#### Performance Benchmarks

```bash
# LLM latency / throughput in isolation
python scripts/bench_llm.py

# Full pipeline latency against live backend
python scripts/e2e_timing.py
```

#### Linting & Static Analysis

```bash
# Python type checking (if mypy is installed)
mypy models/ml/ backend/

# Python linting (if ruff is installed)
ruff check models/ml/ backend/

# Frontend type checking
cd frontend && npx tsc --noEmit
```

---

## Reliability, Performance & Security

### Benchmarks & Maturity Status

| Metric | Value | Notes |
|---|---|---|
| **Ingestion latency** | < 50 ms | Per reading, even during LLM inference |
| **Preliminary diagnosis** | < 2 ms | Rule-based fallback |
| **Final diagnosis** | 10-30 s | LLM inference (7B model on 8GB RAM) |
| **Telemetry throughput** | 10 Hz+ per vehicle | Sustained WebSocket stream |
| **LLM tokens/sec** | ~15-25 t/s | qwen2.5:7b-instruct on consumer hardware |
| **Maturity Status** | **Beta** | Production-ready core, gaps in frontend integration |

**Current readiness state:**
- ✅ Core detection pipeline stable and tested
- ✅ Backend API functional with comprehensive tests
- ✅ Graceful degradation fully implemented
- ⚠️ Frontend partially connected (WebSocket client implemented, visualization complete)
- ⚠️ No authentication or transport security (plaintext ws://)
- ⚠️ No CI/CD pipeline
- ⚠️ Limited observability (no structured logging, no metrics export)

### Troubleshooting & Known Limitations

| Issue | Symptoms | Workaround |
|---|---|---|
| **Ollama unreachable** | Diagnoses always use rule fallback, no LLM refinement | Check `OLLAMA_URL`, ensure `ollama serve` is running, or set `MACHSIGHT_USE_STUB=1` |
| **High LLM latency** | Final diagnosis takes > 30 seconds | Use `qwen2.5:3b-instruct` for faster inference on 4GB RAM |
| **Frontend not connecting** | Dashboard shows "DISCONNECTED" | Verify backend running on port 8000, check firewall, ensure WebSocket URL is correct |
| **SQLite growing unbounded** | `telemetry.db` file size increases over time | Implement retention policy (see Future Work) |
| **False positives on startup** | Anomalies detected during initial warmup | Allow system to accumulate baseline data before fault injection |
| **motor_mismatch never triggers** | Dual-motor fault never detected | Fault requires per-wheel telemetry fields; currently scaffolding for future chassis |

**Known technical trade-offs:**
- **Single SQLite connection** — Works for single-process at 10Hz, will not scale to multi-worker
- **No ingestion validation** — Malformed frames pass through; need Pydantic validation
- **Pickle for baseline** — Portable but not diffable; JSON/NPZ would be better
- **No pagination on REST** — `limit` only; needs cursor pagination for large histories
- **Frontend uses Tailwind CDN** — Not production-ready; needs build step

### Security Reporting

**Current security posture:**
- ❌ No authentication on any endpoint
- ❌ No transport encryption (ws://, http:// only)
- ❌ No input validation on ingest path
- ❌ No rate limiting
- ❌ Secrets in environment variables (no secret management)

**Security best practices for deployment:**
1. **Authentication:** Add API key or JWT authentication for WebSocket and REST endpoints
2. **Transport security:** Enable TLS (wss://, https://) for all communications
3. **Input validation:** Add Pydantic models on ingest path to reject malformed frames
4. **Rate limiting:** Implement rate limiting on WebSocket connections and REST API
5. **Secret management:** Use environment-specific secret management (e.g., HashiCorp Vault)
6. **Network isolation:** Deploy in isolated network segment, minimize attack surface
7. **Audit logging:** Enable structured logging with request IDs for security audits

**Vulnerability disclosure:**
- For security vulnerabilities, please report privately via project maintainers
- Do not open public issues for security problems
- Include reproduction steps, affected versions, and potential impact
- Maintainers will respond within 7 days with timeline for fix

---

## Governance & License

### Open Source & Licensing

**License:** ISC (see `frontend/package.json`)

**Contribution Guidelines:**
1. Fork the repository and create a feature branch
2. Write tests for new functionality (backend: pytest, frontend: Vitest)
3. Ensure all tests pass (`python -m pytest` and `npm test`)
4. Run type checking (`npx tsc --noEmit` for frontend)
5. Follow existing code style (Python: PEP 8, TypeScript: existing patterns)
6. Submit pull request with clear description of changes

**Code Style Rules:**
- **Python:** PEP 8, type hints where possible, docstrings for public APIs
- **TypeScript:** Strict mode enabled, no `any` types, functional components
- **Git:** Conventional commits format (`feat:`, `fix:`, `docs:`, etc.)
- **Testing:** Test coverage > 80% for new code, integration tests for API changes

**Release Process:**
1. Update version numbers in `package.json` and `backend/requirements.txt`
2. Update CHANGELOG.md with breaking changes and new features
3. Tag release with semantic versioning (v1.0.0, v1.1.0, etc.)
4. Create GitHub release with release notes
5. Deploy to production (containerization recommended)

**Project Governance:**
- Maintained by ASYNC26 team
- Roadmap and priorities discussed in project meetings
- Breaking changes require team consensus
- Security issues handled with priority

### Additional Resources

- **[Architecture Documentation](ARCHITECTURE.md)** — Complete system design and implementation details
- **[Backend API Docs](backend/README.md)** — WebSocket contracts and REST endpoints
- **[Dataset Catalog](docs/DATASET_CATALOG.md)** — Supported industrial datasets
- **[Phase 5 Report](docs/PHASE_5.md)** — Industrial data foundation implementation
- **[Interactive API Docs](http://localhost:8000/docs)** — Swagger UI (when backend running)

---

## Acknowledgements

Built as a staged implementation for ASYNC26 hackathon. The system demonstrates edge-local AI diagnostics with conditioned statistical baselines, autonomous multi-hop reasoning, and graceful degradation from LLM to rule-based fallbacks.

Special thanks to:
- **Ollama** for local LLM inference
- **FastAPI** for the modern async web framework
- **React & Vite** for the responsive frontend tooling
- **CWRU, LIAS, and Paderborn University** for industrial datasets

---

**Last Updated:** October 2026
**Version:** 1.0.0-beta
**Status:** Beta — Production-ready core, ongoing frontend integration work
