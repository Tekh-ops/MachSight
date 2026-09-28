#!/usr/bin/env bash
# run_demo.sh — MachSight end-to-end demo launcher
#
# Starts the backend, verifies Ollama is running and the model is available,
# then prints the exact commands for the demo sequence.
#
# Usage:
#   bash scripts/run_demo.sh [--skip-ollama-check] [--model <model_name>]
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BACKEND_HOST="${MACHSIGHT_HOST:-localhost}"
BACKEND_PORT="${MACHSIGHT_PORT:-8000}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
DEFAULT_MODEL="${MACHSIGHT_LLM_MODEL:-qwen2.5:7b-instruct}"
SKIP_OLLAMA_CHECK=0
MODEL="$DEFAULT_MODEL"
VENV_DIR="${VENV_DIR:-.venv}"

# Parse flags
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-ollama-check) SKIP_OLLAMA_CHECK=1; shift ;;
        --model) MODEL="$2"; shift 2 ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[demo]${NC}  $*"; }
success() { echo -e "${GREEN}[demo]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[demo]${NC}  $*"; }
error()   { echo -e "${RED}[demo]${NC}  $*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
check_python() {
    if [[ -f "$VENV_DIR/bin/python" ]]; then
        PYTHON="$VENV_DIR/bin/python"
    elif command -v python3 &>/dev/null; then
        PYTHON="python3"
    else
        error "Python 3 not found. Please install Python 3.10+."
        exit 1
    fi
    info "Python: $PYTHON ($($PYTHON --version))"
}

check_dependencies() {
    info "Checking Python dependencies…"
    local missing=()
    for pkg in fastapi uvicorn websockets httpx numpy scipy; do
        if ! $PYTHON -c "import $pkg" 2>/dev/null; then
            missing+=("$pkg")
        fi
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing packages: ${missing[*]}"
        error "Install with: pip install ${missing[*]}"
        exit 1
    fi
    success "All Python dependencies present."
}

check_reference_pkl() {
    local ref_path="models/ml/reference.pkl"
    if [[ ! -f "$ref_path" ]]; then
        warn "reference.pkl not found — building from healthy_telemetry.csv…"
        $PYTHON -c "
from models.ml.reference_builder import build_reference_set, save_reference_set
ref = build_reference_set('models/ml/healthy_telemetry.csv')
save_reference_set(ref, '$ref_path')
print('Built reference.pkl with', ref['total_samples'], 'samples.')
"
        success "reference.pkl built."
    else
        success "reference.pkl found: $ref_path"
    fi
}

check_ollama() {
    if [[ $SKIP_OLLAMA_CHECK -eq 1 ]]; then
        warn "Ollama check skipped (--skip-ollama-check flag set)."
        warn "Reasoning will fall back to rule-based stub if LLM is unreachable."
        return
    fi

    info "Checking Ollama at $OLLAMA_URL …"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$OLLAMA_URL/api/tags" 2>/dev/null || echo "000")

    if [[ "$http_code" != "200" ]]; then
        error "Ollama is NOT running (HTTP $http_code from $OLLAMA_URL)."
        error "Start Ollama with:   ollama serve"
        error "Then pull the model: ollama pull $MODEL"
        error "Re-run this script after Ollama is ready."
        error "OR run with --skip-ollama-check to use the deterministic stub."
        exit 1
    fi
    success "Ollama is running."

    # Check the model is available
    info "Checking model '$MODEL' …"
    local tags
    tags=$(curl -s "$OLLAMA_URL/api/tags" 2>/dev/null)
    if echo "$tags" | grep -q "$MODEL"; then
        success "Model '$MODEL' is available."
    else
        warn "Model '$MODEL' not found locally. Pulling now…"
        warn "(This may take several minutes on first run.)"
        ollama pull "$MODEL"
        success "Model pulled."
    fi
}

start_backend() {
    info "Starting MachSight backend…"
    local log_file="/tmp/machsight_backend.log"

    # Kill any existing backend on our port
    if lsof -Pi :"$BACKEND_PORT" -sTCP:LISTEN -t &>/dev/null; then
        warn "Port $BACKEND_PORT is already in use. Attempting to reuse existing backend."
        warn "(If it's stale: kill \$(lsof -t -i:$BACKEND_PORT))"
    else
        nohup $PYTHON -m uvicorn backend.main:app \
            --host "$BACKEND_HOST" \
            --port "$BACKEND_PORT" \
            --log-level warning \
            > "$log_file" 2>&1 &
        BACKEND_PID=$!
        echo "$BACKEND_PID" > /tmp/machsight_backend.pid
        info "Backend PID: $BACKEND_PID  (logs: $log_file)"

        # Wait for it to be ready
        local retries=20
        while [[ $retries -gt 0 ]]; do
            if curl -sf "http://$BACKEND_HOST:$BACKEND_PORT/health" &>/dev/null; then
                break
            fi
            sleep 0.5
            retries=$((retries - 1))
        done

        if ! curl -sf "http://$BACKEND_HOST:$BACKEND_PORT/health" &>/dev/null; then
            error "Backend failed to start. Check logs: $log_file"
            exit 1
        fi
        success "Backend is up at http://$BACKEND_HOST:$BACKEND_PORT"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           MachSight Demo Launcher                    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Must be run from the project root
if [[ ! -f "backend/main.py" ]]; then
    error "Must be run from the MachSight project root."
    error "Usage: bash scripts/run_demo.sh"
    exit 1
fi

check_python
check_dependencies
check_reference_pkl
check_ollama
start_backend

# ---------------------------------------------------------------------------
# Print demo command sequence
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Demo Command Sequence${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Backend is running.  Open a NEW terminal for each command below.${NC}"
echo ""

echo -e "${YELLOW}── 1. Watch live events (WebSocket client) ─────────────${NC}"
echo "   $PYTHON -c \""
echo "   import asyncio, websockets, json"
echo "   async def watch():"
echo "       async with websockets.connect('ws://$BACKEND_HOST:$BACKEND_PORT/ws') as ws:"
echo "           print('Listening…')"
echo "           while True:"
echo "               msg = json.loads(await ws.recv())"
echo "               print(f\"{msg['type']:25s} {json.dumps(msg.get('data',{}))[:120]}\")"
echo "   asyncio.run(watch())"
echo "   \""
echo ""

echo -e "${YELLOW}── 2a. Healthy stream (no fault, 10 seconds) ───────────${NC}"
echo "   $PYTHON scripts/mock_car.py --fault none --duration 10"
echo ""

echo -e "${YELLOW}── 2b. Drag fault demo (healthy first, then drag) ──────${NC}"
echo "   $PYTHON scripts/mock_car.py --fault drag --duration 30 --start-fault-after 5 --verbose"
echo ""

echo -e "${YELLOW}── 2c. Mechanical jam demo ──────────────────────────────${NC}"
echo "   $PYTHON scripts/mock_car.py --fault jam --duration 20 --start-fault-after 3"
echo ""

echo -e "${YELLOW}── 2d. Sensor fault demo ────────────────────────────────${NC}"
echo "   $PYTHON scripts/mock_car.py --fault sensor_fault --duration 20 --start-fault-after 5"
echo ""

echo -e "${YELLOW}── 3.  Replay healthy_telemetry.csv at 4× speed ────────${NC}"
echo "   $PYTHON scripts/replay.py --source models/ml/healthy_telemetry.csv --speed 4"
echo ""

echo -e "${YELLOW}── 4.  Replay stored DB trace ───────────────────────────${NC}"
echo "   $PYTHON scripts/replay.py --source backend/telemetry.db --speed 1"
echo ""

echo -e "${YELLOW}── 5.  REST API — recent investigations ─────────────────${NC}"
echo "   curl -s http://$BACKEND_HOST:$BACKEND_PORT/api/investigations | python3 -m json.tool"
echo ""

echo -e "${YELLOW}── 6.  REST API — full telemetry history ────────────────${NC}"
echo "   curl -s http://$BACKEND_HOST:$BACKEND_PORT/api/telemetry?limit=20 | python3 -m json.tool"
echo ""

echo -e "${YELLOW}── 7.  Service status ───────────────────────────────────${NC}"
echo "   curl -s http://$BACKEND_HOST:$BACKEND_PORT/api/status | python3 -m json.tool"
echo ""

echo -e "${YELLOW}── 8.  Stop backend ─────────────────────────────────────${NC}"
echo "   kill \$(cat /tmp/machsight_backend.pid 2>/dev/null) 2>/dev/null || true"
echo ""

echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  MachSight is ready.  Choose a fault mode and watch the diagnosis appear!${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo ""
