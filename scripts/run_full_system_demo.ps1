# run_full_system_demo.ps1
#
# Windows requirements:
#   - Python installed system-wide and available as `py`
#   - Node.js/npm installed system-wide
#   - No virtual environments
#
# Run from MachSight project root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\run_full_system_demo.ps1

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

$MachSightDir = (Get-Location).Path
$SimDir = Join-Path (Split-Path $MachSightDir -Parent) "MachSight-Simulator"
$FrontendDir = Join-Path $MachSightDir "frontend"

if (-not (Test-Path (Join-Path $MachSightDir "backend\main.py"))) {
    throw "Run this script from the MachSight project root."
}

if (-not (Test-Path $SimDir)) {
    throw "MachSight-Simulator directory not found: $SimDir"
}

if (-not (Test-Path $FrontendDir)) {
    throw "Frontend directory not found: $FrontendDir"
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

$SimulatorPort = 8765
$BackendPort = 8000
$FrontendPort = 5173

$LogDir = Join-Path $MachSightDir "logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$SimulatorStdoutLog = Join-Path $LogDir "machsight_simulator.stdout.log"
$SimulatorStderrLog = Join-Path $LogDir "machsight_simulator.stderr.log"

$BackendStdoutLog = Join-Path $LogDir "machsight_backend.stdout.log"
$BackendStderrLog = Join-Path $LogDir "machsight_backend.stderr.log"

$FrontendStdoutLog = Join-Path $LogDir "machsight_frontend.stdout.log"
$FrontendStderrLog = Join-Path $LogDir "machsight_frontend.stderr.log"

$SimProcess = $null
$BackendProcess = $null
$FrontendProcess = $null

# ---------------------------------------------------------------------------
# Required commands
# ---------------------------------------------------------------------------

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python launcher 'py' was not found on PATH."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm was not found on PATH."
}

# ---------------------------------------------------------------------------
# Stop process using a port
# ---------------------------------------------------------------------------

function Stop-Process-OnPort($Port) {
    $connections = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue

    foreach ($connection in $connections) {
        $processId = $connection.OwningProcess

        if ($processId -and $processId -ne 0) {
            Stop-Process `
                -Id $processId `
                -Force `
                -ErrorAction SilentlyContinue
        }
    }

    Start-Sleep -Milliseconds 500
}

Stop-Process-OnPort $SimulatorPort
Stop-Process-OnPort $BackendPort
Stop-Process-OnPort $FrontendPort

# ---------------------------------------------------------------------------
# Start Simulator
#
# PYTHONUTF8=1 prevents Windows cp1252 from breaking on the simulator's
# Unicode output.
# ---------------------------------------------------------------------------

$env:PYTHONUTF8 = "1"

$SimProcess = Start-Process `
    -FilePath "py" `
    -ArgumentList @(
        "-m", "simulator",
        "--host", "127.0.0.1",
        "--port", "$SimulatorPort",
        "--log-level", "WARNING"
    ) `
    -WorkingDirectory $SimDir `
    -RedirectStandardOutput $SimulatorStdoutLog `
    -RedirectStandardError $SimulatorStderrLog `
    -PassThru `
    -WindowStyle Hidden

# ---------------------------------------------------------------------------
# Wait for Simulator
# ---------------------------------------------------------------------------

$ready = $false

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500

    try {
        $response = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$SimulatorPort/simulation/status" `
            -UseBasicParsing `
            -TimeoutSec 2 `
            -ErrorAction Stop

        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
            $ready = $true
            break
        }
    }
    catch {
    }

    if ($SimProcess.HasExited) {
        break
    }
}

if (-not $ready) {
    if (Test-Path $SimulatorStderrLog) {
        Get-Content $SimulatorStderrLog -Tail 30
    }

    throw "Simulator failed to start."
}

# ---------------------------------------------------------------------------
# Start Backend
# ---------------------------------------------------------------------------

$BackendProcess = Start-Process `
    -FilePath "py" `
    -ArgumentList @(
        "-m", "uvicorn",
        "main:app",
        "--host", "127.0.0.1",
        "--port", "$BackendPort",
        "--log-level", "warning"
    ) `
    -WorkingDirectory (Join-Path $MachSightDir "backend") `
    -RedirectStandardOutput $BackendStdoutLog `
    -RedirectStandardError $BackendStderrLog `
    -PassThru `
    -WindowStyle Hidden

# ---------------------------------------------------------------------------
# Wait for Backend
# ---------------------------------------------------------------------------

$ready = $false

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500

    try {
        $response = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$BackendPort/health" `
            -UseBasicParsing `
            -TimeoutSec 2 `
            -ErrorAction Stop

        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
            $ready = $true
            break
        }
    }
    catch {
    }

    if ($BackendProcess.HasExited) {
        break
    }
}

if (-not $ready) {
    if (Test-Path $BackendStderrLog) {
        Get-Content $BackendStderrLog -Tail 30
    }

    throw "Backend failed to start."
}

# ---------------------------------------------------------------------------
# Start Frontend
# ---------------------------------------------------------------------------

$FrontendProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @(
        "run", "dev",
        "--",
        "--host", "127.0.0.1",
        "--port", "$FrontendPort"
    ) `
    -WorkingDirectory $FrontendDir `
    -RedirectStandardOutput $FrontendStdoutLog `
    -RedirectStandardError $FrontendStderrLog `
    -PassThru `
    -WindowStyle Hidden

Start-Sleep -Seconds 2

if ($FrontendProcess.HasExited) {
    if (Test-Path $FrontendStderrLog) {
        Get-Content $FrontendStderrLog -Tail 30
    }

    throw "Frontend failed to start."
}

# ---------------------------------------------------------------------------
# Keep services alive
# ---------------------------------------------------------------------------

try {
    while ($true) {
        Start-Sleep -Seconds 1

        if ($SimProcess.HasExited) {
            throw "Simulator process exited."
        }

        if ($BackendProcess.HasExited) {
            throw "Backend process exited."
        }

        if ($FrontendProcess.HasExited) {
            throw "Frontend process exited."
        }
    }
}
finally {

    foreach ($process in @(
        $SimProcess,
        $BackendProcess,
        $FrontendProcess
    )) {
        if ($null -ne $process) {
            try {
                if (-not $process.HasExited) {
                    Stop-Process `
                        -Id $process.Id `
                        -Force `
                        -ErrorAction SilentlyContinue
                }
            }
            catch {
            }
        }
    }
}