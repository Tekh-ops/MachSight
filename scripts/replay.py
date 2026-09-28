#!/usr/bin/env python3
"""replay.py — Replay stored telemetry traces into the MachSight backend.

Supports two source formats:
  1. SQLite DB  — reads from raw_telemetry table in a MachSight telemetry.db
  2. CSV file   — reads any CSV with columns matching the raw_telemetry schema

Replays at original inter-reading timing (preserving the original cadence) or
at a user-supplied speed multiplier.

Usage:
  python scripts/replay.py --source backend/telemetry.db [OPTIONS]
  python scripts/replay.py --source models/ml/healthy_telemetry.csv [OPTIONS]

Options:
  --source    Path to .db (SQLite) or .csv file (required)
  --speed     Playback speed multiplier (default: 1.0; 2.0 = 2× faster)
  --host      Backend host (default: localhost)
  --port      Backend port (default: 8000)
  --car-id    Override car_id for all replayed rows (optional)
  --limit     Max number of rows to replay (default: all)
  --verbose   Print each row sent
"""

import argparse
import asyncio
import csv
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import List, Dict, Any

try:
    import websockets
except ImportError:
    print("ERROR: 'websockets' not installed.  Run: pip install websockets")
    sys.exit(1)


# Fields expected by the backend ingestion WebSocket
REQUIRED_FIELDS = {"car_id", "distance_cm", "current_a", "rpm", "pwm_command", "mode"}


def _load_from_sqlite(path: Path, limit: int) -> List[Dict[str, Any]]:
    """Load rows from raw_telemetry table of a MachSight SQLite DB."""
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    sql = "SELECT * FROM raw_telemetry ORDER BY id ASC"
    if limit > 0:
        sql += f" LIMIT {limit}"
    rows = [dict(r) for r in conn.execute(sql).fetchall()]
    conn.close()
    if not rows:
        raise ValueError(f"No rows found in raw_telemetry table of {path}")
    print(f"[replay] Loaded {len(rows)} rows from SQLite: {path}")
    return rows


def _load_from_csv(path: Path, limit: int) -> List[Dict[str, Any]]:
    """Load rows from a CSV file with raw_telemetry columns."""
    rows = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if limit > 0 and i >= limit:
                break
            # Type coercions
            try:
                rows.append({
                    "id":          i + 1,
                    "timestamp":   float(row["timestamp"]) if row.get("timestamp") else None,
                    "car_id":      row.get("car_id", "car-01"),
                    "distance_cm": float(row["distance_cm"]),
                    "current_a":   float(row["current_a"]),
                    "rpm":         float(row["rpm"]),
                    "pwm_command": int(float(row["pwm_command"])),
                    "mode":        row["mode"],
                })
            except (KeyError, ValueError) as exc:
                print(f"[replay] WARNING: Skipping row {i+1}: {exc}")
    if not rows:
        raise ValueError(f"No usable rows loaded from CSV: {path}")
    print(f"[replay] Loaded {len(rows)} rows from CSV: {path}")
    return rows


def _validate_rows(rows: List[Dict[str, Any]]) -> None:
    """Warn about any rows missing required fields."""
    sample = rows[0] if rows else {}
    missing = REQUIRED_FIELDS - set(sample.keys())
    if missing:
        print(f"[replay] WARNING: First row is missing fields: {missing}")


async def replay_stream(args: argparse.Namespace) -> None:
    source = Path(args.source)
    if not source.exists():
        print(f"[replay] ERROR: Source file not found: {source}")
        sys.exit(1)

    # Load rows
    suffix = source.suffix.lower()
    if suffix == ".db":
        rows = _load_from_sqlite(source, args.limit)
    elif suffix == ".csv":
        rows = _load_from_csv(source, args.limit)
    else:
        print(f"[replay] ERROR: Unsupported file type '{suffix}'. Use .db or .csv")
        sys.exit(1)

    _validate_rows(rows)

    url = f"ws://{args.host}:{args.port}/telemetry/ingest"
    print(f"[replay] Connecting to {url}  (speed={args.speed}×)")

    try:
        async with websockets.connect(url, ping_interval=None) as ws:
            print(f"[replay] Connected. Replaying {len(rows)} readings…")
            sent = 0
            replay_start_wall = time.time()

            for i, row in enumerate(rows):
                # Build send payload
                payload = {
                    "car_id":      args.car_id if args.car_id else row.get("car_id", "car-01"),
                    "timestamp":   time.time(),  # live timestamp for backend
                    "distance_cm": row["distance_cm"],
                    "current_a":   row["current_a"],
                    "rpm":         row["rpm"],
                    "pwm_command": row["pwm_command"],
                    "mode":        row["mode"],
                }

                # Calculate inter-reading sleep from original timestamps
                if i + 1 < len(rows):
                    t_this = row.get("timestamp") or 0.0
                    t_next = rows[i + 1].get("timestamp") or 0.0
                    original_gap = max(0.0, t_next - t_this)
                    sleep_for = original_gap / max(args.speed, 0.01)
                else:
                    sleep_for = 0.0

                await ws.send(json.dumps(payload))
                sent += 1

                if args.verbose:
                    print(f"  [row {i+1}/{len(rows)}] {json.dumps(payload)}")
                elif sent % 50 == 0:
                    elapsed = time.time() - replay_start_wall
                    print(f"  [replay] {sent}/{len(rows)} sent  ({elapsed:.1f}s elapsed)")

                if sleep_for > 0:
                    await asyncio.sleep(sleep_for)

            elapsed = time.time() - replay_start_wall
            print(f"[replay] Done. Sent {sent} readings in {elapsed:.2f}s.")

    except (ConnectionRefusedError, OSError) as exc:
        print(f"[replay] ERROR: Cannot connect to {url} — {exc}")
        print("[replay] Is the backend running?  Try: uvicorn backend.main:app --host 0.0.0.0 --port 8000")
        sys.exit(1)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MachSight telemetry trace replayer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--source",  required=True,
                        help="Path to .db (SQLite) or .csv file")
    parser.add_argument("--speed",   type=float, default=1.0,
                        help="Playback speed multiplier (default: 1.0)")
    parser.add_argument("--host",    default="localhost",
                        help="Backend host (default: localhost)")
    parser.add_argument("--port",    type=int, default=8000,
                        help="Backend port (default: 8000)")
    parser.add_argument("--car-id",  default=None, dest="car_id",
                        help="Override car_id for all rows (optional)")
    parser.add_argument("--limit",   type=int, default=0,
                        help="Max rows to replay (default: all)")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Print each row sent")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(replay_stream(args))
