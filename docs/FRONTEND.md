# MachSight Frontend — Operator Diagnostic Dashboard (Phase 6)

## 1. Architectural Overview

The MachSight Frontend is an operator-focused industrial diagnostic dashboard. It provides real-time situational awareness, multi-modal telemetry visualization, and transparent explainability for MachSight's autonomous anomaly detection and diagnostic reasoning engine.

### Core Product Data Flow
```
PHYSICAL / SIMULATED VEHICLE (MachSight-Simulator, Port 8765)
          ↓ (Ultrasonic, Current, RPM, Throttle, PWM)
MACHSIGHT INGESTION & PIPELINE (FastAPI + ML, Port 8000)
          ↓ (Multivariate Mahalanobis scoring, Z-scores, Bucket matching)
DIAGNOSTIC REASONER (Qwen 2.5 3B local LLM + Deterministic Fallback)
          ↓ (WebSocket Bus: ws://localhost:8000/ws)
OPERATOR DASHBOARD (React 19 + TypeScript + Vite)
    ├── Machine Status Banner (Nominal / Anomaly / Sensor Issue)
    ├── Live Telemetry Cards (Current A, RPM, Distance cm)
    ├── Real-Time Synchronized Signal Charts (Rolling 60 samples with anomaly bands)
    ├── Subsystem Schematic Topology (SVG vehicle schematic with fault isolation)
    ├── Structured Explainability Trail (Observations → Evidence → Reasoning → Diagnosis)
    ├── Chronological Diagnostic Event Timeline
    ├── Data Quality & Pipeline Diagnostics
    └── Advanced Technical Wire Payload Inspector
```

---

## 2. Directory & Component Structure

```
frontend/
├── src/
│   ├── types/
│   │   └── domain.ts             # Strict TypeScript definitions for backend contracts
│   ├── utils/
│   │   └── formatters.ts         # Timestamps, relative time deltas, and engineering numbers
│   ├── hooks/
│   │   └── useMachSightWebSocket.ts  # Lifecycle, auto-connect, backoff, and event parsing
│   ├── components/
│   │   ├── Header.tsx            # SCADA topbar, connection states, and tab switching
│   │   ├── MachineStatusBanner.tsx # Health hero indicator, active anomaly counter
│   │   ├── TelemetryCards.tsx    # High-contrast live sensor cards with anomaly indicators
│   │   ├── LiveSignalCharts.tsx  # Multi-channel SVG rolling charts with anomaly highlight bands
│   │   ├── DiagnosticPanel.tsx   # Structured explainability & operator recommendation panel
│   │   ├── MachineSchematic.tsx  # Dynamic vector SVG RC vehicle subsystem schematic
│   │   ├── DiagnosticTimeline.tsx # Chronological event stream with category filtering
│   │   ├── DataQualityPanel.tsx  # Ingestion freshness, plausibility, and z-score metrics
│   │   ├── TechnicalDetails.tsx  # Expandable inspection of raw JSON wire frames
│   │   └── SimulatorControls.tsx # Hardware-in-the-loop simulator and fault injector
│   ├── pages/
│   │   └── PrimaryDashboard.tsx  # Unified operator monitoring interface
│   ├── __tests__/
│   │   └── dashboard.test.tsx    # 15 automated test specifications (Vitest + JSDOM)
│   ├── App.tsx                   # Main application coordinating tabs and global modals
│   └── main.tsx                  # React root mount
├── package.json                  # Dependencies (React 19, Vitest, Testing Library)
├── vite.config.ts                # Vite & Vitest configuration
└── index.html                    # Tailwind CDN & dark mode support
```

---

## 3. Backend Contracts & Data Integration

### 3.1 WebSocket Telemetry (`processed` event)
Broadcast on `ws://localhost:8000/ws`:
```json
{
  "type": "processed",
  "event": "processed",
  "data": {
    "raw_id": 1024,
    "timestamp": 1790796072.26,
    "machine_id": "rc-sim-01",
    "distance_cm": 48.2,
    "current_a": 2.41,
    "rpm": 1842.0,
    "mode": "forward",
    "pwm_command": 150,
    "is_anomaly": 0,
    "mahalanobis_distance": 0.42,
    "current_zscore": 0.15,
    "rpm_zscore": -0.10,
    "distance_plausible": 1,
    "bucket_used": "forward_150"
  }
}
```

### 3.2 WebSocket Diagnosis (`diagnosis` event)
Double-encoded payload containing reasoning, evidence, and recommendations:
```json
{
  "type": "diagnosis",
  "data": {
    "trace_id": "40208d16-1ff1-49b6-bf50-fa4d0ed7808c",
    "timestamp": 1790796082.35,
    "step_type": "diagnosis",
    "payload": {
      "action": "diagnose",
      "diagnosis": "Mechanical drag detected in drivetrain transmission",
      "confidence": 0.92,
      "severity": "warning",
      "suspected_component": "drivetrain",
      "recommended_action": "Inspect drive axle and wheel bearings for foreign debris.",
      "evidence_used": [
        "Motor current elevated to 3.8A while wheel RPM dropped to 420 RPM under 150 PWM",
        "Mahalanobis distance exceeded 3.5σ threshold"
      ],
      "ui_hints": {
        "highlight_metrics": ["current_a", "rpm"],
        "suggested_charts": ["telemetry_overview"]
      },
      "stage": "final"
    }
  }
}
```

---

## 4. Connection & Reconnection Management

The dashboard includes a resilient connection lifecycle implemented in `useMachSightWebSocket.ts`:
1. **Auto-Connect**: On application mount, the client immediately connects to `ws://localhost:8000/ws` without requiring manual interaction.
2. **Reconnection with Exponential Backoff**: If connection drops, reconnection attempts occur with progressive intervals (1s, 2s, 4s, up to 15s max).
3. **Connection States**:
   - `CONNECTED`: Green indicator, real-time live packet streaming.
   - `CONNECTING`: Blue indicator during initial handshake.
   - `RECONNECTING`: Amber indicator; displays non-intrusive alert banner while preserving historical buffer.
   - `DISCONNECTED`: Red indicator; prompts manual retry button and displays last valid telemetry timestamp.
4. **Zero Data Fabrication**: Disconnected states clearly indicate connection loss and never invent simulated live values.

---

## 5. Live Signal Charts & Component Schematic

### 5.1 Real-Time Signal Charts
- **Channels**: Synchronized Motor Current (A), Wheel RPM (RPM), and Ultrasonic Distance (cm).
- **Rolling Window**: Retains a clean 60-point sliding window.
- **Anomaly Shading**: Periods flagged with `is_anomaly === 1` are highlighted with translucent red vertical bands directly correlated to backend statistical anomaly events.
- **Performance**: Rendered via pure SVG vectors without heavyweight external charting libraries.

### 5.2 Vehicle Schematic Visualization
- Vector blueprint of the RC rover chassis, ultrasonic sensor, DC motor, drivetrain transmission, four wheels, battery, and controller.
- Dynamically highlights any component identified in backend `suspected_component` (e.g. `drivetrain`, `motor`, `ultrasonic`, `battery`).
- Neutral state clearly reads: `Component not identified / All subsystems nominal`.

---

## 6. How to Run the Frontend

### Prerequisites
- Node.js (v18+) & npm

### Development Server
```bash
cd frontend
npm install
npm run dev
```
The operator dashboard is available at `http://localhost:5173`.

### Production Build
```bash
cd frontend
npm run build
npm run preview
```

### Running Test Suite
```bash
cd frontend
npm test
```
Runs the 15 comprehensive specifications verifying dashboard rendering, real-time telemetry updates, anomaly transitions, structured explainability, schematic fault isolation, and connection failure recovery.
