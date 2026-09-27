import sqlite3
from pathlib import Path

# Path to the SQLite telemetry database file
DB_PATH = Path(__file__).resolve().parent / "telemetry.db"


def get_db_connection() -> sqlite3.Connection:
    """Returns a connection to the SQLite telemetry database with sqlite3.Row row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initializes the SQLite database file if it does not already exist."""
    with get_db_connection() as conn:
        conn.commit()


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at {DB_PATH}")
