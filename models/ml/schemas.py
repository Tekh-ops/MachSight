"""Schemas for telemetry readings and anomaly detector outputs in IndustrialDoctor.

Defines typed data structures for sensor data captured from the RC car
and the structured diagnostic output produced by the statistical anomaly detector.
"""

from typing import TypedDict, List, Dict, Optional, Literal
from dataclasses import dataclass, asdict

# Allowed car operating modes
OperatingMode = Literal["idle", "forward", "turning_left", "turning_right", "braking"]


class TelemetryReading(TypedDict):
    """Schema for a single telemetry snapshot from the RC car.

    Fields:
        timestamp: Epoch timestamp of the sensor acquisition in seconds.
        car_id: Unique string identifier for the car under diagnosis.
        distance_cm: Ultrasonic sensor measurement in centimeters.
        current_a: Motor current draw in Amperes.
        rpm: Wheel revolutions per minute.
        pwm_command: Commanded Pulse Width Modulation value (0-255).
        mode: Operating mode of the car ('idle', 'forward', 'turning_left',
              'turning_right', 'braking').
    """
    timestamp: float
    car_id: str
    distance_cm: float
    current_a: float
    rpm: float
    pwm_command: int
    mode: str


class FeatureBaselineComparison(TypedDict):
    """Statistical baseline comparison for an individual telemetry feature.

    Fields:
        value: The observed feature value from the current reading.
        baseline_mean: Expected mean value for this feature in the matched bucket.
        baseline_std: Standard deviation of this feature in the matched bucket.
        z_score: Optional z-score showing deviations in standard units.
        pct_diff: Optional percentage difference relative to baseline mean.
    """
    value: float
    baseline_mean: float
    baseline_std: float
    z_score: Optional[float]
    pct_diff: Optional[float]


class DetectorOutput(TypedDict):
    """Output schema produced by the statistical anomaly detector.

    Fields:
        is_anomaly: True if the computed anomaly score exceeds the detection threshold.
        anomaly_score: Distance metric (Mahalanobis distance or fallback z-score).
        mode: Matched or fallback operating mode.
        pwm_command: Commanded PWM of the input reading.
        matched_pwm: The PWM level of the reference bucket actually used for baseline.
        reasons: Human-readable diagnostic explanations detailing why an anomaly
                 was flagged or noting fallback behaviors.
        features: Breakdown of individual feature values against their baseline statistics.
    """
    is_anomaly: bool
    anomaly_score: float
    mode: str
    pwm_command: int
    matched_pwm: int
    reasons: List[str]
    features: Dict[str, FeatureBaselineComparison]


@dataclass
class BucketReference:
    """Statistical reference profile for a specific (mode, pwm_command) operational bucket.

    Stores multivariate Gaussian parameters (mean vector and covariance matrix)
    for (current_a, rpm), sample count, and flags for low-sample fallback.
    """
    mode: str
    pwm_command: int
    sample_count: int
    mean_vector: List[float]  # [current_a_mean, rpm_mean]
    covariance_matrix: List[List[float]]  # 2x2 covariance matrix
    inv_covariance_matrix: List[List[float]]  # Precomputed inverse covariance for performance
    current_mean: float
    current_std: float
    rpm_mean: float
    rpm_std: float
    use_zscore_fallback: bool  # True when sample_count < 20 or singular covariance

    def to_dict(self) -> dict:
        """Convert dataclass to standard Python dictionary for serialization."""
        return asdict(self)
