"""Machine-scoped state manager for IndustrialDoctor.

Implements Objective 3: each physical machine (identified by machine_id) has
its OWN isolated state so that Machine A's anomaly counter, rolling buffer,
investigation lock, and cooldown timer NEVER contaminate Machine B.

This replaces the global variables that existed at module level in main.py.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from config import (
    CONSECUTIVE_ANOMALY_THRESHOLD,
    INVESTIGATION_COOLDOWN_SECONDS,
    ROLLING_BUFFER_MAXLEN,
)


@dataclass
class MachineState:
    """All mutable per-machine runtime state."""

    machine_id: str

    # Rolling buffer of recent raw telemetry readings (with _seq stamps)
    rolling_buffer: deque = field(default_factory=lambda: deque(maxlen=ROLLING_BUFFER_MAXLEN))

    # Monotonically increasing sequence counter for collect_window()
    reading_seq: int = 0

    # Consecutive anomaly counter (resets on each normal reading or when
    # an investigation is triggered)
    consecutive_anomalies: int = 0

    # Single-flight flag: True while an investigation coroutine is running
    is_investigating: bool = False

    # Epoch timestamp when the most-recent investigation ended
    last_investigation_end_time: float = 0.0

    # Asyncio lock protecting single-flight investigation entry
    investigation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # -----------------------------------------------------------------------
    # Convenience predicates
    # -----------------------------------------------------------------------

    def is_on_cooldown(self, now: Optional[float] = None) -> bool:
        """True if the investigation cooldown has not yet elapsed."""
        t = now if now is not None else time.time()
        return (t - self.last_investigation_end_time) < INVESTIGATION_COOLDOWN_SECONDS

    def cooldown_remaining(self, now: Optional[float] = None) -> float:
        """Seconds remaining in the cooldown window (0.0 if not active)."""
        t = now if now is not None else time.time()
        return max(0.0, INVESTIGATION_COOLDOWN_SECONDS - (t - self.last_investigation_end_time))

    def should_trigger_investigation(self) -> bool:
        """True when consecutive anomaly count reaches the threshold and
        no investigation is currently running or cooling down."""
        return (
            self.consecutive_anomalies >= CONSECUTIVE_ANOMALY_THRESHOLD
            and not self.is_investigating
            and not self.is_on_cooldown()
        )

    def record_anomaly(self) -> None:
        self.consecutive_anomalies += 1

    def reset_anomaly_counter(self) -> None:
        self.consecutive_anomalies = 0

    def mark_investigation_started(self) -> None:
        self.is_investigating = True
        self.reset_anomaly_counter()

    def mark_investigation_ended(self) -> None:
        self.is_investigating = False
        self.last_investigation_end_time = time.time()

    def append_reading(self, reading: Dict[str, Any]) -> None:
        self.reading_seq += 1
        reading["_seq"] = self.reading_seq
        self.rolling_buffer.append(reading)

    def collect_window_since(self, start_seq: int) -> List[Dict[str, Any]]:
        """Return readings added after start_seq, or recent slice as fallback."""
        collected = [r for r in list(self.rolling_buffer) if r.get("_seq", 0) > start_seq]
        if not collected and self.rolling_buffer:
            collected = list(self.rolling_buffer)[-20:]
        return collected


class MachineStateRegistry:
    """
    Central registry of per-machine state objects.

    Thread/coroutine safe: the registry dict itself is created eagerly and
    access is gated by an asyncio lock only during first-time slot creation.
    """

    def __init__(self) -> None:
        self._states: Dict[str, MachineState] = {}
        self._creation_lock: asyncio.Lock = asyncio.Lock()

    def get(self, machine_id: str) -> MachineState:
        """Return existing state or create a new slot synchronously.

        This is safe to call from synchronous code; the lock is only needed
        in the async factory path (get_or_create).
        """
        if machine_id not in self._states:
            self._states[machine_id] = MachineState(machine_id=machine_id)
        return self._states[machine_id]

    async def get_or_create(self, machine_id: str) -> MachineState:
        """Async-safe creation with a lock to prevent duplicate state objects."""
        if machine_id not in self._states:
            async with self._creation_lock:
                if machine_id not in self._states:
                    self._states[machine_id] = MachineState(machine_id=machine_id)
        return self._states[machine_id]

    def all_machine_ids(self) -> List[str]:
        return list(self._states.keys())

    def summary(self) -> Dict[str, Dict[str, Any]]:
        """Return a status snapshot for every known machine."""
        out: Dict[str, Dict[str, Any]] = {}
        for mid, state in self._states.items():
            out[mid] = {
                "machine_id": mid,
                "is_investigating": state.is_investigating,
                "consecutive_anomalies": state.consecutive_anomalies,
                "cooldown_active": state.is_on_cooldown(),
                "cooldown_remaining_seconds": round(state.cooldown_remaining(), 1),
                "rolling_buffer_size": len(state.rolling_buffer),
            }
        return out

    # Allow direct attribute-style access for single-machine backwards compat
    def __getitem__(self, machine_id: str) -> MachineState:
        return self.get(machine_id)


# Module-level singleton — imported by main.py
machine_registry: MachineStateRegistry = MachineStateRegistry()
