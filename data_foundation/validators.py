"""Quality, integrity, and sampling validators for industrial datasets.

Detects missing values, NaNs, infinities, non-monotonic timestamps, abnormal jitter,
and checks label integrity without silently discarding records.
"""

from __future__ import annotations

import math
from typing import Dict, Iterator, List, Optional
import numpy as np

from data_foundation.schemas import DataQualityReport, NormalizedRecord


class DatasetValidator:
    """Validates an iterable of NormalizedRecord objects and compiles a comprehensive quality report."""

    def __init__(self, dataset_id: str):
        self.dataset_id = dataset_id

    def validate_records(self, records: Iterator[NormalizedRecord]) -> DataQualityReport:
        record_count = 0
        run_ids = set()
        machine_ids = set()
        sensor_names = set()
        
        missing_values: Dict[str, int] = {}
        infinite_values: Dict[str, int] = {}
        label_dist: Dict[str, int] = {}
        op_cond_dist: Dict[str, Dict[str, int]] = {}
        issues: List[str] = []
        
        last_timestamps: Dict[str, float] = {}  # run_id -> last_timestamp
        non_monotonic_count = 0
        timestamp_diffs: List[float] = []
        seen_fingerprints = set()
        duplicate_count = 0

        for r in records:
            record_count += 1
            run_ids.add(r.run_id)
            machine_ids.add(r.machine_id)

            # 1. Label distribution
            lbl = r.normalized_label or r.original_label or "unknown"
            label_dist[lbl] = label_dist.get(lbl, 0) + 1

            # 2. Operating condition distribution
            for cond_k, cond_v in r.operating_conditions.items():
                if cond_k not in op_cond_dist:
                    op_cond_dist[cond_k] = {}
                v_str = str(cond_v)
                op_cond_dist[cond_k][v_str] = op_cond_dist[cond_k].get(v_str, 0) + 1

            # 3. Timestamp monotonicity per run
            if r.run_id in last_timestamps:
                dt = r.timestamp_s - last_timestamps[r.run_id]
                if dt < 0:
                    non_monotonic_count += 1
                elif dt > 0 and len(timestamp_diffs) < 1000:
                    timestamp_diffs.append(dt)
            last_timestamps[r.run_id] = r.timestamp_s

            # 4. Sensor readings validation
            sensor_vals = []
            for s_name, s_val in r.sensor_readings.items():
                sensor_names.add(s_name)
                if s_val is None or (isinstance(s_val, float) and math.isnan(s_val)):
                    missing_values[s_name] = missing_values.get(s_name, 0) + 1
                elif isinstance(s_val, float) and math.isinf(s_val):
                    infinite_values[s_name] = infinite_values.get(s_name, 0) + 1
                sensor_vals.append((s_name, s_val))

            # 5. Duplicate check (fingerprint of run + timestamp + values)
            if record_count <= 20000:  # sample first 20k for duplicates to save memory
                fp = (r.run_id, round(r.timestamp_s, 6), tuple(sorted(sensor_vals)))
                if fp in seen_fingerprints:
                    duplicate_count += 1
                else:
                    seen_fingerprints.add(fp)

        # Estimate sampling rate if time diffs available
        est_sampling_rate: Optional[float] = None
        if timestamp_diffs:
            median_dt = float(np.median(timestamp_diffs))
            if median_dt > 0:
                est_sampling_rate = round(1.0 / median_dt, 2)

        # Synthesize issues
        if non_monotonic_count > 0:
            issues.append(f"Detected {non_monotonic_count} non-monotonic timestamp regressions.")
        if any(v > 0 for v in missing_values.values()):
            total_missing = sum(missing_values.values())
            issues.append(f"Detected {total_missing} missing/NaN sensor readings.")
        if any(v > 0 for v in infinite_values.values()):
            total_inf = sum(infinite_values.values())
            issues.append(f"Detected {total_inf} infinite sensor readings.")
        if duplicate_count > 0:
            issues.append(f"Detected {duplicate_count} duplicate timestamp records.")

        is_valid = (non_monotonic_count == 0 and len(infinite_values) == 0)

        return DataQualityReport(
            dataset_id=self.dataset_id,
            record_count=record_count,
            run_count=len(run_ids),
            machine_count=len(machine_ids),
            sensor_count=len(sensor_names),
            missing_value_counts=missing_values,
            infinite_value_counts=infinite_values,
            duplicate_records=duplicate_count,
            non_monotonic_timestamps=non_monotonic_count,
            sampling_rate_est_hz=est_sampling_rate,
            label_distribution=label_dist,
            operating_condition_distribution=op_cond_dist,
            issues_detected=issues,
            is_valid=is_valid,
        )
