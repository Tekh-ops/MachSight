#!/usr/bin/env bash
# run_full_system_demo.sh — Phase 5.5 Full System Demo Launcher
#
# Starts the Simulator, the MachSight Backend, and the Vite Frontend.
# Run from the MachSight/ project root:
#   bash scripts/run_full_system_demo.sh
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${CYAN}[demo]${NC}  $*"; }
success() { echo -e "${GREEN}[demo]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[demo]${NC}  $*"; }
error()   { echo -e "${RED}[demo]${NC}  $*"; >&2; }

# Resolve Python for each project's own venv
resolve_python() {
    local project_dir="$1"
    if [[ -f "${project_dir}/.venv/bin/python" ]]; then
        echo "${project_dir}/.venv/bin/python"
    elif command -v python3 &>/dev/null; then
        echo "python3"
    else
        error "Python 3 not found for ${project_dir}"; exit 1
    fi
}

# Must be run from MachSight project root
MACHSIGHT_DIR="$(pwd)"
SIM_DIR="$(cd ../MachSight-Simulator && pwd)"

if [[ ! -f "${MACHSIGHT_DIR}/backend/main.py" ]]; then
    error "Run this script from the MachSight/ project root."
    exit 1
fi

MACHSIGHT_PYTHON="$(resolve_python "${MACHSIGHT_DIR}")"
SIM_PYTHON="$(resolve_python "${SIM_DIR}")"

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           MachSight Phase 5.5 System Demo            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Kill anything already on these ports
for port in 8765 8000; do
    pid=$(lsof -t -i:"${port}" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        warn "Killing stale process on port ${port} (PID ${pid})"
        kill "$pid" 2>/dev/null || true
        sleep 0.5
    fi
done

# 1. Start Simulator (uses its own venv)
info "Starting Simulator on port 8765..."
pushd "${SIM_DIR}" > /dev/null
nohup "${SIM_PYTHON}" -m simulator --host 127.0.0.1 --port 8765 --log-level WARNING \
    > /tmp/machsight_simulator.log 2>&1 &
SIM_PID=$!
popd > /dev/null

# Wait for simulator readiness
retries=20
until curl -sf http://127.0.0.1:8765/simulation/status &>/dev/null; do
    sleep 0.5
    retries=$((retries - 1))
    if [[ $retries -le 0 ]]; then
        error "Simulator failed to start. Check /tmp/machsight_simulator.log"
        tail -20 /tmp/machsight_simulator.log
        exit 1
    fi
done
success "Simulator is up at http://127.0.0.1:8765 (PID: ${SIM_PID})"

# 2. Start Backend (uses MachSight venv, run from project root)
info "Starting MachSight Backend on port 8000..."
nohup "${MACHSIGHT_PYTHON}" -m uvicorn backend.main:app \
    --host 127.0.0.1 --port 8000 --log-level warning \
    > /tmp/machsight_backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend readiness
retries=20
until curl -sf http://127.0.0.1:8000/health &>/dev/null; do
    sleep 0.5
    retries=$((retries - 1))
    if [[ $retries -le 0 ]]; then
        error "Backend failed to start. Check /tmp/machsight_backend.log"
        tail -20 /tmp/machsight_backend.log
        exit 1
    fi
done
success "Backend is up at http://127.0.0.1:8000 (PID: ${BACKEND_PID})"

# 3. Start Frontend
info "Starting Frontend (Vite)..."
pushd "${MACHSIGHT_DIR}/frontend" > /dev/null
nohup npm run dev -- --host 127.0.0.1 --port 5173 \
    > /tmp/machsight_frontend.log 2>&1 &
FRONTEND_PID=$!
popd > /dev/null

# Wait a moment for Vite to bind
sleep 2
success "Frontend started (PID: ${FRONTEND_PID})"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             All Systems Are Go!                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${YELLOW}Dashboard :${NC} http://127.0.0.1:5173"
echo -e "  ${YELLOW}Backend   :${NC} http://127.0.0.1:8000"
echo -e "  ${YELLOW}Simulator :${NC} http://127.0.0.1:8765"
echo ""
echo -e "  Logs: /tmp/machsight_{simulator,backend,frontend}.log"
echo ""
echo -e "  Press Ctrl+C to stop all services."
echo ""

cleanup() {
    echo ""
    info "Stopping all services..."
    kill "${SIM_PID}" "${BACKEND_PID}" "${FRONTEND_PID}" 2>/dev/null || true
    success "All services stopped."
}
trap cleanup EXIT INT TERM

wait

