"""Pydantic validation boundary for IndustrialDoctor telemetry ingestion.

Defines a generalised machine-oriented telemetry contract (schema_version 2)
while remaining fully compatible with the existing RC-car simulator and tests.

Design principles:
- machine_id is the canonical machine identity; car_id is accepted as an alias.
- All industrial sensor signals are optional (temperature, vibration, pressure, …).
- RC-car-specific fields (distance_cm, pwm_command, mode, rpm, current_a) are
  preserved and still optional at the schema level so that different machine
  types can omit what they do not have.
- Validation REJECTS: missing machine identity, NaN, Inf, impossible physical
  values where bounds are known.
- Validation PASSES: absent optional sensors.
"""

import math
import time
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Allowed operating modes (RC-car vocabulary; future machine types may add more)
# ---------------------------------------------------------------------------
ALLOWED_MODES = frozenset(
    {"idle", "forward", "turning_left", "turning_right", "braking", "unknown"}
)


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

class OperatingState(BaseModel):
    """Machine operating context (mode, RPM, load percentage, PWM command)."""

    mode: str = Field(default="unknown", description="Operating mode string")
    rpm: Optional[float] = Field(default=None, ge=0.0, le=200_000.0)
    pwm_command: Optional[int] = Field(default=None, ge=0, le=255)
    load_pct: Optional[float] = Field(default=None, ge=0.0, le=100.0)

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        v = str(v).strip().lower()
        if v not in ALLOWED_MODES:
            # Unknown modes are coerced rather than rejected — future machine
            # types may introduce new mode strings.
            return "unknown"
        return v

    @field_validator("rpm", "load_pct", mode="before")
    @classmethod
    def reject_nan_inf_float(cls, v: Any) -> Any:
        if v is None:
            return v
        fv = float(v)
        if math.isnan(fv) or math.isinf(fv):
            raise ValueError(f"NaN or Inf not allowed: {v!r}")
        return fv


class SensorSignals(BaseModel):
    """
    Sensor signal payload.

    RC-car signals (current_a, rpm, distance_cm, pwm_command) are kept for
    backward compatibility.  Industrial signals (voltage_v, temperature_c,
    vibration_rms, pressure_bar, acoustic_db) are all optional.

    Physical bound checks are applied only where hard limits are known.
    """

    # RC-car / drive signals
    current_a: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1_000.0,
        description="Motor/phase current in Amperes",
    )
    rpm: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=200_000.0,
        description="Shaft / wheel RPM",
    )
    distance_cm: Optional[float] = Field(
        default=None,
        description="Ultrasonic distance in centimetres (valid range 0–500 cm)",
    )
    pwm_command: Optional[int] = Field(
        default=None,
        ge=0,
        le=255,
        description="PWM command value (0–255)",
    )

    # Industrial / generic signals
    voltage_v: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100_000.0,
        description="Supply voltage in Volts",
    )
    temperature_c: Optional[float] = Field(
        default=None,
        ge=-273.15,
        le=3_000.0,
        description="Temperature in degrees Celsius",
    )
    vibration_rms: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100_000.0,
        description="RMS vibration amplitude (m/s² or mm/s, unit preserved in metadata)",
    )
    pressure_bar: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=10_000.0,
        description="Pressure in bar",
    )
    acoustic_db: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=200.0,
        description="Acoustic / sound-pressure level in dB",
    )

    @field_validator(
        "current_a",
        "rpm",
        "distance_cm",
        "voltage_v",
        "temperature_c",
        "vibration_rms",
        "pressure_bar",
        "acoustic_db",
        mode="before",
    )
    @classmethod
    def reject_nan_inf(cls, v: Any) -> Any:
        if v is None:
            return v
        try:
            fv = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"Cannot convert {v!r} to float")
        if math.isnan(fv) or math.isinf(fv):
            raise ValueError(f"NaN or Inf sensor value not allowed: {v!r}")
        return fv

    @field_validator("distance_cm", mode="after")
    @classmethod
    def validate_distance_range(cls, v: Optional[float]) -> Optional[float]:
        """Distance must be non-negative if provided.  Upper bound 500 cm."""
        if v is None:
            return v
        if v < 0.0 or v > 500.0:
            raise ValueError(
                f"distance_cm {v:.1f} cm is outside plausible range [0, 500] cm"
            )
        return v


class TelemetrySource(BaseModel):
    """Metadata about the origin of the telemetry packet."""

    transport: str = Field(default="websocket")
    device_id: Optional[str] = Field(default=None)


# ---------------------------------------------------------------------------
# Top-level ingestion model
# ---------------------------------------------------------------------------

class IncomingTelemetry(BaseModel):
    """
    Generalised machine telemetry ingestion contract (schema_version 2).

    Accepts both the new structured form and the legacy flat RC-car form
    so that mock_car.py and existing tests continue to work unchanged.
    """

    schema_version: int = Field(default=2)
    timestamp: Optional[float] = Field(default=None)

    # --- Machine identity ---
    machine_id: Optional[str] = Field(default=None)
    car_id: Optional[str] = Field(default=None)  # legacy RC-car alias
    asset_type: str = Field(default="rc_vehicle")

    # --- Structured sub-objects (new schema) ---
    operating_state: Optional[OperatingState] = Field(default=None)
    signals: Optional[SensorSignals] = Field(default=None)
    source: Optional[TelemetrySource] = Field(default=None)

    # --- Legacy flat RC-car fields (preserved for backward compat) ---
    mode: Optional[str] = Field(default=None)
    pwm_command: Optional[int] = Field(default=None, ge=0, le=255)
    current_a: Optional[float] = Field(default=None, ge=0.0, le=1_000.0)
    rpm: Optional[float] = Field(default=None, ge=0.0, le=200_000.0)
    distance_cm: Optional[float] = Field(default=None)
    voltage_v: Optional[float] = Field(default=None, ge=0.0, le=100_000.0)
    temperature_c: Optional[float] = Field(default=None, ge=-273.15, le=3_000.0)
    vibration_rms: Optional[float] = Field(default=None, ge=0.0, le=100_000.0)
    pressure_bar: Optional[float] = Field(default=None, ge=0.0, le=10_000.0)

    @field_validator(
        "current_a",
        "rpm",
        "distance_cm",
        "voltage_v",
        "temperature_c",
        "vibration_rms",
        "pressure_bar",
        mode="before",
    )
    @classmethod
    def reject_nan_inf_flat(cls, v: Any) -> Any:
        if v is None:
            return v
        try:
            fv = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"Cannot convert {v!r} to float")
        if math.isnan(fv) or math.isinf(fv):
            raise ValueError(f"NaN or Inf sensor value not allowed: {v!r}")
        return fv

    @field_validator("distance_cm", mode="after")
    @classmethod
    def validate_distance_flat(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if v < 0.0 or v > 500.0:
            raise ValueError(
                f"distance_cm {v:.1f} cm is outside plausible range [0, 500] cm"
            )
        return v

    @model_validator(mode="after")
    def ensure_machine_id_and_timestamp(self) -> "IncomingTelemetry":
        # Resolve machine_id from car_id alias if needed
        if not self.machine_id:
            if self.car_id:
                self.machine_id = self.car_id
            else:
                raise ValueError(
                    "Telemetry must provide 'machine_id' or legacy 'car_id'"
                )

        # Auto-fill timestamp with server time if absent
        if self.timestamp is None:
            self.timestamp = time.time()

        return self

    def to_legacy_dict(self) -> Dict[str, Any]:
        """
        Return a flat dict compatible with the existing ML pipeline.

        Merges structured sub-objects back into the legacy flat format that
        process_reading(), score_reading(), and classify() all expect.
        """
        d: Dict[str, Any] = {
            "schema_version": self.schema_version,
            "machine_id": self.machine_id,
            "car_id": self.car_id or self.machine_id,
            "asset_type": self.asset_type,
            "timestamp": self.timestamp,
        }

        # Flat legacy fields take precedence if provided
        if self.mode is not None:
            d["mode"] = self.mode
        if self.pwm_command is not None:
            d["pwm_command"] = self.pwm_command
        if self.current_a is not None:
            d["current_a"] = self.current_a
        if self.rpm is not None:
            d["rpm"] = self.rpm
        if self.distance_cm is not None:
            d["distance_cm"] = self.distance_cm
        if self.voltage_v is not None:
            d["voltage_v"] = self.voltage_v
        if self.temperature_c is not None:
            d["temperature_c"] = self.temperature_c
        if self.vibration_rms is not None:
            d["vibration_rms"] = self.vibration_rms
        if self.pressure_bar is not None:
            d["pressure_bar"] = self.pressure_bar

        # Merge structured operating_state sub-object
        if self.operating_state:
            os_ = self.operating_state
            d.setdefault("mode", os_.mode)
            if os_.rpm is not None:
                d.setdefault("rpm", os_.rpm)
            if os_.pwm_command is not None:
                d.setdefault("pwm_command", os_.pwm_command)

        # Merge structured signals sub-object
        if self.signals:
            sig = self.signals
            if sig.current_a is not None:
                d.setdefault("current_a", sig.current_a)
            if sig.rpm is not None:
                d.setdefault("rpm", sig.rpm)
            if sig.distance_cm is not None:
                d.setdefault("distance_cm", sig.distance_cm)
            if sig.pwm_command is not None:
                d.setdefault("pwm_command", sig.pwm_command)
            if sig.voltage_v is not None:
                d.setdefault("voltage_v", sig.voltage_v)
            if sig.temperature_c is not None:
                d.setdefault("temperature_c", sig.temperature_c)
            if sig.vibration_rms is not None:
                d.setdefault("vibration_rms", sig.vibration_rms)
            if sig.pressure_bar is not None:
                d.setdefault("pressure_bar", sig.pressure_bar)

        # Fill required ML-pipeline defaults for optional fields
        d.setdefault("mode", "unknown")
        d.setdefault("pwm_command", 0)
        d.setdefault("current_a", 0.0)
        d.setdefault("rpm", 0.0)
        d.setdefault("distance_cm", 0.0)

        return d
