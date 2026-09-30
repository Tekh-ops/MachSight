"""Deterministic Preprocessing and Feature Extraction for Industrial Data.

Handles unit conversion, sliding window aggregation, statistical feature extraction
(RMS, crest factor, kurtosis, etc.), and records complete preprocessing provenance.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Tuple
import numpy as np


class Preprocessor:
    """Configurable, reproducible preprocessor for industrial sensor time-series."""

    def __init__(
        self,
        window_size: int = 2048,
        step_size: int = 1024,
        unit_conversions: Optional[Dict[str, str]] = None,
        config_seed: int = 42,
    ):
        self.window_size = window_size
        self.step_size = step_size
        self.unit_conversions = unit_conversions or {}
        self.config_seed = config_seed
        self.version = "1.0.0"

    def get_config_hash(self) -> str:
        """Return deterministic sha256 hash of preprocessing hyperparameters."""
        cfg = {
            "window_size": self.window_size,
            "step_size": self.step_size,
            "unit_conversions": self.unit_conversions,
            "config_seed": self.config_seed,
            "version": self.version,
        }
        raw = json.dumps(cfg, sort_keys=True)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    @classmethod
    def convert_unit(cls, value: float, from_unit: str, to_unit: str) -> float:
        """Perform explicit, verified physical unit conversion."""
        if from_unit == to_unit:
            return value

        # Angular velocity: rad/s to RPM (1 rad/s = 60 / (2 * pi) RPM ~ 9.5493 RPM)
        if from_unit == "rad/s" and to_unit == "RPM":
            return value * (60.0 / (2.0 * math.pi))
        if from_unit == "RPM" and to_unit == "rad/s":
            return value * ((2.0 * math.pi) / 60.0)

        # Current: mA to A
        if from_unit == "mA" and to_unit == "A":
            return value / 1000.0
        if from_unit == "A" and to_unit == "mA":
            return value * 1000.0

        # Acceleration: g to m/s^2 (standard gravity = 9.80665 m/s^2)
        if from_unit == "g" and to_unit == "m/s^2":
            return value * 9.80665
        if from_unit == "m/s^2" and to_unit == "g":
            return value / 9.80665

        raise ValueError(f"Unsupported unit conversion from '{from_unit}' to '{to_unit}'")

    @classmethod
    def compute_window_features(cls, signal: np.ndarray) -> Dict[str, float]:
        """Compute standard time-domain statistical diagnostic features for a 1D window.
        
        Features computed:
          - max, min, peak_to_peak
          - mean, std, variance
          - rms (root mean square)
          - skewness (3rd standardized moment)
          - kurtosis (4th standardized moment)
          - crest_factor (peak / rms)
          - form_factor (rms / mean_abs)
        """
        arr = np.asarray(signal, dtype=np.float64)
        n = len(arr)
        if n == 0:
            return {}

        val_max = float(np.max(arr))
        val_min = float(np.min(arr))
        p2p = val_max - val_min
        mean = float(np.mean(arr))
        var = float(np.var(arr))
        std = float(np.std(arr)) if n > 1 else 0.0
        rms = float(np.sqrt(np.mean(arr ** 2)))

        # Skewness and kurtosis
        if std > 1e-9:
            centered = arr - mean
            skewness = float(np.mean((centered / std) ** 3))
            kurt = float(np.mean((centered / std) ** 4)) - 3.0  # excess kurtosis
        else:
            skewness = 0.0
            kurt = 0.0

        # Crest factor (peak / RMS)
        peak = max(abs(val_max), abs(val_min))
        crest_factor = float(peak / rms) if rms > 1e-9 else 0.0

        # Form factor (RMS / mean absolute value)
        mean_abs = float(np.mean(np.abs(arr)))
        form_factor = float(rms / mean_abs) if mean_abs > 1e-9 else 0.0

        return {
            "max": round(val_max, 5),
            "min": round(val_min, 5),
            "peak_to_peak": round(p2p, 5),
            "mean": round(mean, 5),
            "std": round(std, 5),
            "rms": round(rms, 5),
            "skewness": round(skewness, 5),
            "kurtosis": round(kurt, 5),
            "crest_factor": round(crest_factor, 5),
            "form_factor": round(form_factor, 5),
        }
