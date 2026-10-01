"""Diagnostic Lifecycle Tracker for MachSight.

Tracks the diagnostic state of a machine over time:

    NORMAL → FAULT_SUSPECTED → ANALYZING → DIAGNOSED → MONITORING → RECOVERED

Key principles:
  - STOPPED / IDLE with no motor command is NOT a fault.
  - Transitions are driven by evidence, not raw sensor values.
  - Recovery is detected when previously faulted signals return to baseline.
  - The lifecycle prevents stale fault states from persisting after recovery.
  - One lifecycle tracker per machine_id (instantiated by machine_registry).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from .temporal_evidence import MachineOperatingState, DiagnosticEvidencePacket, Persistence


class DiagnosticLifecycleState(str, Enum):
    NORMAL = "NORMAL"
    FAULT_SUSPECTED = "FAULT_SUSPECTED"
    ANALYZING = "ANALYZING"
    DIAGNOSED = "DIAGNOSED"
    MONITORING = "MONITORING"
    RECOVERED = "RECOVERED"


class DiagnosticTrigger(str, Enum):
    """Why a diagnostic reasoning cycle was triggered."""
    ANOMALY_THRESHOLD = "anomaly_threshold"        # N consecutive anomalies
    OPERATING_STATE_CHANGE = "operating_state_change"  # CRUISING → FAULTED
    PERSISTENT_FAULT = "persistent_fault"          # Existing fault still present
    RECOVERY_DETECTED = "recovery_detected"        # Signals returning to baseline
    MANUAL_REQUEST = "manual_request"              # Explicit API trigger


@dataclass
class DiagnosticEvent:
    """Records a lifecycle transition event for audit / display."""
    timestamp: float
    from_state: DiagnosticLifecycleState
    to_state: DiagnosticLifecycleState
    trigger: DiagnosticTrigger
    operating_state: str
    evidence_summary: str


@dataclass
class DiagnosticLifecycle:
    """Per-machine diagnostic lifecycle state machine.

    Tracks fault onset, diagnosis, monitoring, and recovery.
    Thread-safe for asyncio coroutines (single-threaded event loop).
    """

    machine_id: str

    # Current lifecycle state
    state: DiagnosticLifecycleState = DiagnosticLifecycleState.NORMAL

    # Previous operating state (to detect transitions)
    last_operating_state: MachineOperatingState = MachineOperatingState.UNKNOWN

    # Timestamp of when the current fault epoch began
    fault_onset_time: Optional[float] = None

    # Timestamp of when the last recovery was detected
    last_recovery_time: Optional[float] = None

    # Timestamp of the last diagnostic reasoning invocation
    last_diagnosed_time: Optional[float] = None

    # History of lifecycle events
    events: List[DiagnosticEvent] = field(default_factory=list)

    # Minimum seconds between repeated diagnoses for the same fault
    min_rediagnosis_interval_s: float = 20.0

    # Seconds of recovery signals required before declaring RECOVERED
    recovery_confirmation_s: float = 5.0

    # Timestamp when recovery signals first appeared
    _recovery_start_time: Optional[float] = None

    def _transition(
        self,
        to_state: DiagnosticLifecycleState,
        trigger: DiagnosticTrigger,
        operating_state: str = "",
        evidence_summary: str = "",
    ) -> None:
        """Perform a lifecycle state transition and record the event."""
        if to_state == self.state:
            return  # no-op

        event = DiagnosticEvent(
            timestamp=time.time(),
            from_state=self.state,
            to_state=to_state,
            trigger=trigger,
            operating_state=operating_state,
            evidence_summary=evidence_summary,
        )
        self.events.append(event)
        # Keep event log bounded
        if len(self.events) > 100:
            self.events = self.events[-50:]

        self.state = to_state

    def update(
        self,
        packet: DiagnosticEvidencePacket,
        is_anomaly: bool,
        consecutive_anomalies: int,
    ) -> Optional[DiagnosticTrigger]:
        """Update the lifecycle state based on the latest evidence packet.

        Returns the trigger type if a diagnostic reasoning session should be
        invoked now, or None if no action is needed.

        Called on every telemetry tick — must be fast (no I/O).
        """
        now = time.time()
        op_state = packet.operating_state
        op_str = op_state.value

        # ---------------------------------------------------------------
        # 1. Recovery detection — signals returning to baseline
        # ---------------------------------------------------------------
        is_recovering_signals = (
            op_state in (MachineOperatingState.CRUISING, MachineOperatingState.IDLE,
                         MachineOperatingState.STOPPED, MachineOperatingState.ACCELERATING)
            and not is_anomaly
            and self.state in (
                DiagnosticLifecycleState.DIAGNOSED,
                DiagnosticLifecycleState.MONITORING,
            )
        )

        if is_recovering_signals:
            if self._recovery_start_time is None:
                self._recovery_start_time = now
            elif (now - self._recovery_start_time) >= self.recovery_confirmation_s:
                # Recovery confirmed
                self._transition(
                    DiagnosticLifecycleState.RECOVERED,
                    DiagnosticTrigger.RECOVERY_DETECTED,
                    operating_state=op_str,
                    evidence_summary="Signals returned to healthy baseline.",
                )
                self.last_recovery_time = now
                self._recovery_start_time = None
                self.fault_onset_time = None
                return DiagnosticTrigger.RECOVERY_DETECTED
        else:
            # Reset recovery timer if signals are still abnormal
            self._recovery_start_time = None

        # ---------------------------------------------------------------
        # 2. Reset RECOVERED → NORMAL after a short period
        # ---------------------------------------------------------------
        if self.state == DiagnosticLifecycleState.RECOVERED and not is_anomaly:
            self._transition(
                DiagnosticLifecycleState.NORMAL,
                DiagnosticTrigger.RECOVERY_DETECTED,
                operating_state=op_str,
                evidence_summary="Machine confirmed normal after recovery.",
            )
            return None

        # ---------------------------------------------------------------
        # 3. Fault onset detection
        # ---------------------------------------------------------------
        fault_active = op_state in (
            MachineOperatingState.FAULTED,
            MachineOperatingState.FAULT_SUSPECTED,
        )

        if fault_active and self.state == DiagnosticLifecycleState.NORMAL:
            self._transition(
                DiagnosticLifecycleState.FAULT_SUSPECTED,
                DiagnosticTrigger.OPERATING_STATE_CHANGE,
                operating_state=op_str,
                evidence_summary="Operating state changed to FAULT_SUSPECTED.",
            )

        # Operating state change from non-fault to fault
        state_changed_to_fault = (
            fault_active
            and self.last_operating_state not in (
                MachineOperatingState.FAULTED,
                MachineOperatingState.FAULT_SUSPECTED,
            )
        )
        self.last_operating_state = op_state

        # ---------------------------------------------------------------
        # 4. Determine whether to trigger a reasoning session now
        # ---------------------------------------------------------------

        # Trigger: new fault detected
        if state_changed_to_fault and self.state in (
            DiagnosticLifecycleState.FAULT_SUSPECTED,
            DiagnosticLifecycleState.NORMAL,
        ):
            if self.fault_onset_time is None:
                self.fault_onset_time = now
            self._transition(
                DiagnosticLifecycleState.ANALYZING,
                DiagnosticTrigger.OPERATING_STATE_CHANGE,
                operating_state=op_str,
                evidence_summary="New fault onset detected — initiating analysis.",
            )
            return DiagnosticTrigger.OPERATING_STATE_CHANGE

        # Trigger: anomaly threshold reached while in NORMAL/SUSPECTED
        if (
            consecutive_anomalies >= 3
            and is_anomaly
            and self.state in (
                DiagnosticLifecycleState.NORMAL,
                DiagnosticLifecycleState.FAULT_SUSPECTED,
            )
        ):
            if self.fault_onset_time is None:
                self.fault_onset_time = now
            self._transition(
                DiagnosticLifecycleState.ANALYZING,
                DiagnosticTrigger.ANOMALY_THRESHOLD,
                operating_state=op_str,
                evidence_summary=f"{consecutive_anomalies} consecutive anomalies detected.",
            )
            return DiagnosticTrigger.ANOMALY_THRESHOLD

        # Trigger: persistent fault in DIAGNOSED/MONITORING — periodic re-diagnosis
        if (
            self.state in (DiagnosticLifecycleState.DIAGNOSED, DiagnosticLifecycleState.MONITORING)
            and is_anomaly
            and packet.persistence == Persistence.PERSISTENT
            and (
                self.last_diagnosed_time is None
                or (now - self.last_diagnosed_time) >= self.min_rediagnosis_interval_s
            )
        ):
            self._transition(
                DiagnosticLifecycleState.ANALYZING,
                DiagnosticTrigger.PERSISTENT_FAULT,
                operating_state=op_str,
                evidence_summary="Persistent fault continues — re-analyzing.",
            )
            return DiagnosticTrigger.PERSISTENT_FAULT

        return None

    def mark_diagnosed(self) -> None:
        """Called by the reasoning pipeline after a diagnosis has been produced."""
        self.last_diagnosed_time = time.time()
        if self.state == DiagnosticLifecycleState.ANALYZING:
            self._transition(
                DiagnosticLifecycleState.DIAGNOSED,
                DiagnosticTrigger.ANOMALY_THRESHOLD,  # generic
                evidence_summary="Diagnosis produced.",
            )

    def mark_monitoring(self) -> None:
        """Called after diagnosis to transition to MONITORING."""
        if self.state == DiagnosticLifecycleState.DIAGNOSED:
            self._transition(
                DiagnosticLifecycleState.MONITORING,
                DiagnosticTrigger.ANOMALY_THRESHOLD,
                evidence_summary="Monitoring for persistence or recovery.",
            )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "machine_id": self.machine_id,
            "state": self.state.value,
            "fault_onset_time": self.fault_onset_time,
            "last_recovery_time": self.last_recovery_time,
            "last_diagnosed_time": self.last_diagnosed_time,
            "last_operating_state": self.last_operating_state.value,
            "recent_events": [
                {
                    "timestamp": e.timestamp,
                    "from": e.from_state.value,
                    "to": e.to_state.value,
                    "trigger": e.trigger.value,
                    "operating_state": e.operating_state,
                    "summary": e.evidence_summary,
                }
                for e in self.events[-5:]
            ],
        }


class DiagnosticLifecycleRegistry:
    """Global registry of per-machine lifecycle trackers."""

    def __init__(self) -> None:
        self._lifecycles: Dict[str, DiagnosticLifecycle] = {}

    def get(self, machine_id: str) -> DiagnosticLifecycle:
        if machine_id not in self._lifecycles:
            self._lifecycles[machine_id] = DiagnosticLifecycle(machine_id=machine_id)
        return self._lifecycles[machine_id]

    def summary(self) -> Dict[str, Dict[str, Any]]:
        return {mid: lc.to_dict() for mid, lc in self._lifecycles.items()}


# Module-level singleton
diagnostic_lifecycle_registry = DiagnosticLifecycleRegistry()
