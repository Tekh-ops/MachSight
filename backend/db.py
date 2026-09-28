import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "telemetry.db"

# SQLite connection configured for async/multi-thread access from FastAPI
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
conn.row_factory = sqlite3.Row


def init_db() -> None:
    """Creates the database schema if tables do not already exist."""
    cursor = conn.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS raw_telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL, car_id TEXT,
            distance_cm REAL, current_a REAL, rpm REAL,
            pwm_command INTEGER, mode TEXT
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
            step_type TEXT,
            payload TEXT
        );
        """
    )
    conn.commit()

    # Backward-compatible column migrations for processed_telemetry
    cursor.execute("PRAGMA table_info(processed_telemetry)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    for col_name, col_type in [
        ("distance_plausible", "INTEGER DEFAULT 1"),
        ("bucket_used", "TEXT DEFAULT ''"),
        ("is_anomaly", "INTEGER DEFAULT 0"),
    ]:
        if col_name not in existing_cols:
            cursor.execute(f"ALTER TABLE processed_telemetry ADD COLUMN {col_name} {col_type}")
    conn.commit()



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
