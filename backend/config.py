"""Centralized configuration for IndustrialDoctor / MachSight backend.

All tunable constants are read from environment variables with sensible
local-development defaults.  No cloud infrastructure or complex frameworks
are required — just set env vars before starting the server.
"""

import os

# ---------------------------------------------------------------------------
# LLM / Ollama configuration
# ---------------------------------------------------------------------------
# Default reasoning model: Qwen 2.5 3B Instruct (local Ollama)
OLLAMA_MODEL: str = os.environ.get("MACHSIGHT_LLM_MODEL", "qwen2.5:3b-instruct")
OLLAMA_URL: str = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
LLM_TIMEOUT: float = float(os.environ.get("MACHSIGHT_LLM_TIMEOUT", "45"))

# Use the lightweight rule-based stub instead of hitting Ollama
USE_STUB: bool = os.environ.get("MACHSIGHT_USE_STUB", "0").lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Investigation / anomaly thresholds
# ---------------------------------------------------------------------------
# Number of consecutive anomalous readings required to trigger an investigation
CONSECUTIVE_ANOMALY_THRESHOLD: int = int(
    os.environ.get("MACHSIGHT_CONSECUTIVE_ANOMALIES", "3")
)

# Seconds to wait after completing one investigation before starting another
INVESTIGATION_COOLDOWN_SECONDS: float = float(
    os.environ.get("MACHSIGHT_INVESTIGATION_COOLDOWN", "15.0")
)

# Maximum investigation hops (request_more_data loops) per trace
INVESTIGATION_MAX_HOPS: int = int(
    os.environ.get("MACHSIGHT_INVESTIGATION_MAX_HOPS", "3")
)

# ---------------------------------------------------------------------------
# Telemetry ingestion
# ---------------------------------------------------------------------------
# Maximum readings kept in the per-machine rolling buffer
ROLLING_BUFFER_MAXLEN: int = int(
    os.environ.get("MACHSIGHT_ROLLING_BUFFER_MAXLEN", "300")
)

# How many recent buffer entries are passed to analyze() as the rolling window
ANALYSIS_WINDOW_SIZE: int = int(
    os.environ.get("MACHSIGHT_ANALYSIS_WINDOW_SIZE", "20")
)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
import pathlib

DB_PATH: str = os.environ.get(
    "MACHSIGHT_DB_PATH",
    str(pathlib.Path(__file__).resolve().parent / "telemetry.db"),
)

# Schema version stored in new telemetry rows
TELEMETRY_SCHEMA_VERSION: int = 2
