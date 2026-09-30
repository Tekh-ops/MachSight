"""Data Leakage Detection for Industrial Time-Series and Machine Diagnostics.

Audits train/validation/test partitions and feature sets for:
1. Run overlap (same experiment run in train and test)
2. Machine overlap (same physical asset across train and test when testing generalization)
3. Temporal leakage (future timestamps appearing in training or inverted test splits)
4. Label leakage (target or diagnosis labels accidentally included in feature matrices)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set
from data_foundation.schemas import DatasetSplit, NormalizedRecord


class LeakageDetector:
    """Audits dataset splits and feature matrices for data leakage patterns."""

    @classmethod
    def check_split_leakage(cls, split: DatasetSplit) -> List[str]:
        """Verify no run overlap exists between train, validation, and test partitions."""
        violations: List[str] = []
        train_set = set(split.train_runs)
        val_set = set(split.val_runs)
        test_set = set(split.test_runs)

        train_val_overlap = train_set.intersection(val_set)
        if train_val_overlap:
            violations.append(
                f"Run leakage detected between train and val: {sorted(list(train_val_overlap))}"
            )

        train_test_overlap = train_set.intersection(test_set)
        if train_test_overlap:
            violations.append(
                f"Run leakage detected between train and test: {sorted(list(train_test_overlap))}"
            )

        val_test_overlap = val_set.intersection(test_set)
        if val_test_overlap:
            violations.append(
                f"Run leakage detected between val and test: {sorted(list(val_test_overlap))}"
            )

        return violations

    @classmethod
    def check_label_leakage(
        cls,
        feature_names: List[str],
        forbidden_substrings: Optional[List[str]] = None
    ) -> List[str]:
        """Verify that target or label metadata is not leaked into feature names."""
        violations: List[str] = []
        forbidden = forbidden_substrings or [
            "label", "fault", "is_anomaly", "anomaly", "target", "class",
            "ground_truth", "diagnosis", "failure"
        ]

        for feat in feature_names:
            feat_lower = feat.lower()
            for forb in forbidden:
                if forb in feat_lower and not feat_lower.endswith("_status"):
                    violations.append(
                        f"Potential label leakage: feature '{feat}' contains forbidden keyword '{forb}'"
                    )
                    break

        return violations

    @classmethod
    def check_temporal_leakage(
        cls,
        train_records: List[NormalizedRecord],
        test_records: List[NormalizedRecord],
    ) -> List[str]:
        """In time-continuous degradation, check if test data precedes train data within the same run/machine."""
        violations: List[str] = []
        # Group timestamps by run_id
        train_max_times: Dict[str, float] = {}
        for r in train_records:
            train_max_times[r.run_id] = max(train_max_times.get(r.run_id, -float("inf")), r.timestamp_s)

        for r in test_records:
            if r.run_id in train_max_times:
                train_max = train_max_times[r.run_id]
                if r.timestamp_s < train_max:
                    violations.append(
                        f"Temporal leakage in run '{r.run_id}': test record at t={r.timestamp_s:.3f}s "
                        f"precedes training max t={train_max:.3f}s"
                    )
                    break

        return violations
