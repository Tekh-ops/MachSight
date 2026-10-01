"""Synthetic telemetry generator for IndustrialDoctor RC car diagnostic system.

Generates realistic telemetry streams for healthy baseline training and faulty operational
states without requiring physical hardware.
"""

import argparse
import csv
import sys
import time
from typing import List, Dict, Any, Optional
import numpy as np

# Typical healthy baseline configurations per (mode, pwm_command)
HEALTHY_PROFILES: Dict[str, Dict[int, Dict[str, float]]] = {
    "idle": {
        0: {"current_mean": 0.12, "current_std": 0.015, "rpm_mean": 0.0, "rpm_std": 0.0, "distance_mean": 50.0},
    },
    "forward": {
        100: {"current_mean": 0.85, "current_std": 0.04, "rpm_mean": 125.0, "rpm_std": 4.5, "distance_mean": 85.0},
        150: {"current_mean": 1.52, "current_std": 0.08, "rpm_mean": 211.0, "rpm_std": 7.0, "distance_mean": 80.0},
        200: {"current_mean": 1.98, "current_std": 0.10, "rpm_mean": 282.0, "rpm_std": 10.0, "distance_mean": 75.0},
    },
    "turning_left": {
        100: {"current_mean": 1.05, "current_std": 0.05, "rpm_mean": 105.0, "rpm_std": 5.0, "distance_mean": 60.0},
        150: {"current_mean": 1.80, "current_std": 0.08, "rpm_mean": 180.0, "rpm_std": 7.0, "distance_mean": 55.0},
        200: {"current_mean": 2.40, "current_std": 0.11, "rpm_mean": 265.0, "rpm_std": 9.0, "distance_mean": 50.0},
    },
    "turning_right": {
        100: {"current_mean": 1.05, "current_std": 0.05, "rpm_mean": 105.0, "rpm_std": 5.0, "distance_mean": 60.0},
        150: {"current_mean": 1.80, "current_std": 0.08, "rpm_mean": 180.0, "rpm_std": 7.0, "distance_mean": 55.0},
        200: {"current_mean": 2.40, "current_std": 0.11, "rpm_mean": 265.0, "rpm_std": 9.0, "distance_mean": 50.0},
    },
    "braking": {
        0: {"current_mean": 0.65, "current_std": 0.08, "rpm_mean": 15.0, "rpm_std": 4.0, "distance_mean": 45.0},
        50: {"current_mean": 1.35, "current_std": 0.10, "rpm_mean": 40.0, "rpm_std": 8.0, "distance_mean": 40.0},
    },
}

SUPPORTED_FAULTS = ["drag", "jam", "motor_mismatch", "sensor_fault"]


def generate_mock_data(
    samples_per_bucket: int = 50,
    fault: Optional[str] = None,
    car_id: str = "car-01",
    seed: Optional[int] = 42
) -> List[Dict[str, Any]]:
    """Generates a list of synthetic telemetry readings across modes and PWM levels.

    Args:
        samples_per_bucket: Number of telemetry samples generated for each (mode, pwm) bucket.
        fault: Optional fault type ('drag', 'jam', 'motor_mismatch', 'sensor_fault', or None).
        car_id: String identifier for the car.
        seed: Random seed for deterministic simulation.

    Returns:
        List of dictionaries conforming to the TelemetryReading schema.
    """
    if seed is not None:
        np.random.seed(seed)

    rows: List[Dict[str, Any]] = []
    base_time = time.time() - (samples_per_bucket * 10 * 0.1)
    sample_idx = 0

    for mode, pwm_dict in HEALTHY_PROFILES.items():
        for pwm, profile in pwm_dict.items():
            for _ in range(samples_per_bucket):
                ts = round(base_time + (sample_idx * 0.05), 3)
                sample_idx += 1

                # Generate base values with Gaussian noise
                current = float(np.random.normal(profile["current_mean"], profile["current_std"]))
                rpm = float(np.random.normal(profile["rpm_mean"], profile["rpm_std"]))
                dist = float(np.random.normal(profile["distance_mean"], 3.0))

                # Ensure physically non-negative healthy values
                current = max(0.01, current)
                rpm = max(0.0, rpm)
                dist = max(5.0, dist)

                # Fault injection signatures
                if fault == "drag":
                    # Drag fault: Increased motor resistance leads to elevated current and reduced RPM
                    if mode != "idle":
                        current *= float(np.random.uniform(1.4, 1.6))
                        rpm *= float(np.random.uniform(0.55, 0.70))

                elif fault == "jam":
                    # Jam fault: Mechanical lockup causes massive stall current spike and zero RPM while path is clear
                    if mode != "idle":
                        current *= float(np.random.uniform(2.8, 3.8))
                        rpm = float(np.random.uniform(0.0, 5.0))
                        dist = float(np.random.uniform(70.0, 110.0))  # Clear path ahead

                elif fault == "sensor_fault":
                    # Sensor fault: Ultrasonic sensor fails, returning erratic/negative/out-of-bounds readings
                    dist = float(np.random.choice([-15.0, 999.0, -99.9, 1250.0]))

                elif fault == "motor_mismatch":
                    # Single-motor configuration: motor mismatch is not applicable, flagged as future work
                    pass

                rows.append({
                    "timestamp": ts,
                    "car_id": car_id,
                    "distance_cm": round(dist, 2),
                    "current_a": round(current, 3),
                    "rpm": round(rpm, 1),
                    "pwm_command": int(pwm),
                    "mode": mode,
                })

    return rows


def write_mock_csv(rows: List[Dict[str, Any]], output_path: str) -> None:
    """Writes telemetry rows to a CSV file.

    Args:
        rows: List of TelemetryReading dictionaries.
        output_path: File path to save the generated CSV.
    """
    fieldnames = ["timestamp", "car_id", "distance_cm", "current_a", "rpm", "pwm_command", "mode"]
    with open(output_path, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    """Command-line entrypoint for generating synthetic telemetry datasets."""
    parser = argparse.ArgumentParser(
        description="Generate synthetic telemetry datasets for IndustrialDoctor RC car anomaly detection."
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="mock_telemetry.csv",
        help="Target CSV file path (default: mock_telemetry.csv)."
    )
    parser.add_argument(
        "--samples-per-bucket",
        "-n",
        type=int,
        default=50,
        help="Number of samples to generate per (mode, pwm) bucket (default: 50)."
    )
    parser.add_argument(
        "--fault",
        type=str,
        choices=SUPPORTED_FAULTS,
        default=None,
        help="Inject a specific fault type ('drag', 'jam', 'motor_mismatch', 'sensor_fault')."
    )
    parser.add_argument(
        "--car-id",
        type=str,
        default="car-01",
        help="Identifier of the vehicle (default: car-01)."
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility."
    )

    args = parser.parse_args()

    if args.fault == "motor_mismatch":
        print(
            "NOTE: 'motor_mismatch' fault is not applicable to single-motor RC telemetry. "
            "Skipped or reserved for future dual-motor differential drive work.",
            file=sys.stderr
        )

    rows = generate_mock_data(
        samples_per_bucket=args.samples_per_bucket,
        fault=args.fault,
        car_id=args.car_id,
        seed=args.seed
    )

    write_mock_csv(rows, args.output)
    print(f"Successfully generated {len(rows)} telemetry rows -> {args.output}")


if __name__ == "__main__":
    main()
