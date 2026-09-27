"""Reference set builder for statistical anomaly detection in IndustrialDoctor.

Constructs baseline statistical distributions (mean vectors and covariance matrices)
conditioned on operational modes and commanded PWM values from healthy RC car telemetry data.
"""

import csv
import os
import pickle
from collections import defaultdict
from typing import Dict, Tuple, Any, List

import numpy as np
from scipy import linalg


MIN_SAMPLES_FOR_MAHALANOBIS = 20
REGULARIZATION_EPSILON = 1e-6


def build_reference_set(csv_path: str) -> Dict[str, Any]:
    """Builds a statistical baseline reference set from a CSV of healthy telemetry readings.

    Groups telemetry readings by their operational state (mode, pwm_command). For each
    bucket with sufficient samples (>= 20), computes the joint empirical mean vector and
    covariance matrix for (current_a, rpm), along with its regularized matrix inverse.
    If a bucket contains fewer than 20 samples or exhibits singular covariance, it marks
    the bucket for fallback to individual per-feature z-scores.

    Args:
        csv_path: Absolute or relative path to the CSV file containing healthy telemetry.

    Returns:
        A dictionary containing:
            - 'buckets': Dict keyed by string "(mode, pwm_command)" mapping to bucket statistics.
            - 'mode_pwms': Dict mapping each mode string to a sorted list of available integer PWM levels.
            - 'total_samples': Total number of valid rows processed.

    Raises:
        FileNotFoundError: If the provided csv_path does not exist.
        ValueError: If the CSV contains no valid telemetry records.
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Telemetry reference CSV not found at: {csv_path}")

    # Group measurements by (mode, pwm_command)
    grouped_currents: Dict[Tuple[str, int], List[float]] = defaultdict(list)
    grouped_rpms: Dict[Tuple[str, int], List[float]] = defaultdict(list)
    total_samples = 0

    with open(csv_path, mode="r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            mode = row["mode"].strip()
            pwm = int(round(float(row["pwm_command"])))
            current = float(row["current_a"])
            rpm = float(row["rpm"])

            key = (mode, pwm)
            grouped_currents[key].append(current)
            grouped_rpms[key].append(rpm)
            total_samples += 1

    if total_samples == 0:
        raise ValueError(f"No valid telemetry data found in CSV: {csv_path}")

    buckets: Dict[str, Dict[str, Any]] = {}
    mode_pwms: Dict[str, List[int]] = defaultdict(list)

    for (mode, pwm), current_list in grouped_currents.items():
        rpm_list = grouped_rpms[(mode, pwm)]
        sample_count = len(current_list)

        curr_arr = np.asarray(current_list, dtype=np.float64)
        rpm_arr = np.asarray(rpm_list, dtype=np.float64)

        current_mean = float(np.mean(curr_arr))
        current_std = float(np.std(curr_arr, ddof=1)) if sample_count > 1 else 0.0
        rpm_mean = float(np.mean(rpm_arr))
        rpm_std = float(np.std(rpm_arr, ddof=1)) if sample_count > 1 else 0.0

        mean_vector = [current_mean, rpm_mean]

        # Check sample size threshold for multivariate covariance estimation
        if sample_count < MIN_SAMPLES_FOR_MAHALANOBIS:
            use_zscore = True
            cov_matrix = [[current_std ** 2, 0.0], [0.0, rpm_std ** 2]]
            inv_cov_matrix = [[1.0 / max(current_std ** 2, REGULARIZATION_EPSILON), 0.0],
                              [0.0, 1.0 / max(rpm_std ** 2, REGULARIZATION_EPSILON)]]
        else:
            data_matrix = np.column_stack((curr_arr, rpm_arr))
            cov = np.cov(data_matrix, rowvar=False)

            # Ensure 2x2 shape if single feature or edge cases occur
            if cov.shape != (2, 2):
                cov = np.eye(2) * REGULARIZATION_EPSILON

            # Add tiny epsilon to diagonal to prevent singularity when variance is near 0 (e.g. idle)
            cov_reg = cov + np.eye(2) * REGULARIZATION_EPSILON
            try:
                inv_cov = linalg.inv(cov_reg)
                use_zscore = False
            except linalg.LinAlgError:
                # Fallback if matrix is numerically singular despite regularization
                use_zscore = True
                inv_cov = linalg.pinv(cov_reg)

            cov_matrix = cov.tolist()
            inv_cov_matrix = inv_cov.tolist()

        bucket_key = f"{mode}:{pwm}"
        buckets[bucket_key] = {
            "mode": mode,
            "pwm_command": pwm,
            "sample_count": sample_count,
            "mean_vector": mean_vector,
            "covariance_matrix": cov_matrix,
            "inv_covariance_matrix": inv_cov_matrix,
            "current_mean": current_mean,
            "current_std": current_std,
            "rpm_mean": rpm_mean,
            "rpm_std": rpm_std,
            "use_zscore_fallback": use_zscore,
        }
        mode_pwms[mode].append(pwm)

    # Sort PWM lists for deterministic nearest-neighbor lookup
    for mode in mode_pwms:
        mode_pwms[mode].sort()

    return {
        "buckets": buckets,
        "mode_pwms": dict(mode_pwms),
        "total_samples": total_samples,
    }


def save_reference_set(reference: Dict[str, Any], path: str) -> None:
    """Serializes and saves a reference set dictionary to disk using pickle.

    This preserves numpy-compatible array structures and nested baseline metrics
    without requiring external model training frameworks.

    Args:
        reference: The reference baseline dictionary returned by build_reference_set.
        path: Target file path to write the serialized reference set.
    """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(reference, f, protocol=pickle.HIGHEST_PROTOCOL)


def load_reference_set(path: str) -> Dict[str, Any]:
    """Loads and deserializes a reference set dictionary from disk.

    Args:
        path: Path to the serialized reference file on disk.

    Returns:
        The deserialized reference set dictionary.

    Raises:
        FileNotFoundError: If the specified file does not exist.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Serialized reference set not found at: {path}")

    with open(path, "rb") as f:
        return pickle.load(f)
