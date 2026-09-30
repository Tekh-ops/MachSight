"""SQLite persistence layer for IndustrialDoctor / MachSight.

Schema evolution is ALWAYS backward-compatible:
  - New columns are added via ALTER TABLE … ADD COLUMN (only if absent).
  - No existing tables or columns are dropped.
  - DB_PATH is configurable via MACHSIGHT_DB_PATH env var (see config.py).
"""

import os
import sqlite3
from pathlib import Path

# DB path: prefer config if importable, fall back to env/sibling default
try:
    from config import DB_PATH as _CONFIG_DB_PATH
    DB_PATH = Path(_CONFIG_DB_PATH)
except Exception:
    _env_path = os.environ.get("MACHSIGHT_DB_PATH", "")
    DB_PATH = Path(_env_path) if _env_path else Path(__file__).resolve().parent / "telemetry.db"

# SQLite connection configured for async/multi-thread access from FastAPI
conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
conn.row_factory = sqlite3.Row


def init_db() -> None:
    """Creates the database schema if tables do not already exist.

    Uses CREATE TABLE IF NOT EXISTS so re-runs are idempotent.
    Column additions for existing tables use ALTER TABLE … ADD COLUMN
    with an existence check to remain safe across upgrades.
    """
    cursor = conn.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS raw_telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            -- Legacy RC-car identity (kept for backward compat)
            car_id TEXT,
            -- Generalised machine identity (Phase 1 addition)
            machine_id TEXT,
            asset_type TEXT DEFAULT 'rc_vehicle',
            schema_version INTEGER DEFAULT 1,
            -- RC-car / drive signals
            distance_cm REAL, current_a REAL, rpm REAL,
            pwm_command INTEGER, mode TEXT,
            -- Optional industrial signals (NULL when not present)
            voltage_v REAL, temperature_c REAL,
            vibration_rms REAL, pressure_bar REAL
        );

        CREATE TABLE IF NOT EXISTS processed_telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_id INTEGER REFERENCES raw_telemetry(id),
            timestamp REAL,
            current_rpm_ratio REAL, current_zscore REAL,
            rpm_zscore REAL, mahalanobis_distance REAL
        );

        CREATE TABLE IF NOT EXISTS investigations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trace_id TEXT, timestamp REAL,
            -- machine_id added in Phase 1 for multi-machine support
            machine_id TEXT,
            step_type TEXT,
            payload TEXT
        );
        """
    )
    conn.commit()

    # -----------------------------------------------------------------------
    # Backward-compatible column migrations
    # -----------------------------------------------------------------------
    def _ensure_column(table: str, col_name: str, col_type: str) -> None:
        cursor.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in cursor.fetchall()}
        if col_name not in existing:
            cursor.execute(
                f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"
            )
            conn.commit()

    # processed_telemetry: legacy optional columns
    for col_name, col_type in [
        ("distance_plausible", "INTEGER DEFAULT 1"),
        ("bucket_used", "TEXT DEFAULT ''"),
        ("is_anomaly", "INTEGER DEFAULT 0"),
    ]:
        _ensure_column("processed_telemetry", col_name, col_type)

    # raw_telemetry: Phase 1 additions
    for col_name, col_type in [
        ("machine_id", "TEXT"),
        ("asset_type", "TEXT DEFAULT 'rc_vehicle'"),
        ("schema_version", "INTEGER DEFAULT 1"),
        ("voltage_v", "REAL"),
        ("temperature_c", "REAL"),
        ("vibration_rms", "REAL"),
        ("pressure_bar", "REAL"),
    ]:
        _ensure_column("raw_telemetry", col_name, col_type)

    # investigations: Phase 1 machine_id scoping
    _ensure_column("investigations", "machine_id", "TEXT")


def get_db_connection() -> sqlite3.Connection:
    """Returns the shared SQLite connection."""
    return conn


def insert(table: str, row: dict) -> int:
    """Builds a parameterized INSERT statement from dict keys/values and returns cursor.lastrowid."""
    columns = ", ".join(row.keys())
    placeholders = ", ".join(["?"] * len(row))
    sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
    cursor = conn.cursor()
    cursor.execute(sql, tuple(row.values()))
    conn.commit()
    return cursor.lastrowid


def query(sql: str, params: tuple = ()) -> list[dict]:
    """Executes a SELECT query and returns rows as a list of dicts."""
    cursor = conn.cursor()
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    return [dict(r) for r in rows]


# Initialize tables on startup / import
init_db()
