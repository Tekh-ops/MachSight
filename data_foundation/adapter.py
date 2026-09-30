"""Base abstract adapter class for industrial dataset ingestion.

Enforces dataset isolation, raw data immutability, explicit unit and sampling metadata,
safe temporal/run data splitting, and conversion to NormalizedRecord instances.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple
import random
import numpy as np

from data_foundation.schemas import (
    DataQualityReport,
    DatasetManifest,
    DatasetSplit,
    NormalizedRecord,
    SplitStrategy,
)


class IndustrialDatasetAdapter(ABC):
    """Abstract base class for all industrial dataset adapters in MachSight."""

    def __init__(self, source_path: Optional[Path] = None):
        self._source_path = source_path
        self._is_loaded = False

    @property
    @abstractmethod
    def dataset_id(self) -> str:
        """Unique identifier for this dataset."""
        ...

    @property
    @abstractmethod
    def manifest(self) -> DatasetManifest:
        """Machine-readable provenance, licensing, and schema manifest."""
        ...

    @abstractmethod
    def load(self, source_path: Optional[Path] = None) -> None:
        """Load dataset from disk into memory or indexing structures."""
        ...

    @property
    def is_loaded(self) -> bool:
        """Whether the dataset has been loaded."""
        return self._is_loaded

    @abstractmethod
    def get_runs(self) -> List[str]:
        """List all distinct experiment runs, sessions, or profile IDs."""
        ...

    @abstractmethod
    def get_label_mapping(self) -> Dict[str, str]:
        """Mapping from raw dataset labels to normalized label strings."""
        ...

    @abstractmethod
    def get_taxonomy_mapping(self) -> Dict[str, str]:
        """Mapping from raw dataset labels to canonical FaultTaxonomy paths."""
        ...

    @abstractmethod
    def iter_records(self, run_id: Optional[str] = None) -> Iterator[NormalizedRecord]:
        """Yield normalized records for a specific run or the entire dataset."""
        ...

    @abstractmethod
    def validate(self) -> DataQualityReport:
        """Perform data quality, missing value, and temporal monotonicity validation."""
        ...

    def create_splits(
        self,
        strategy: SplitStrategy = SplitStrategy.BY_RUN,
        seed: int = 42,
        test_ratio: float = 0.2,
        val_ratio: float = 0.1,
    ) -> DatasetSplit:
        """Create leakage-free train/validation/test partitions based on runs or cycles.
        
        Guarantees that no run/experiment appears in more than one partition.
        """
        if not self.is_loaded:
            raise RuntimeError(f"Cannot split unloaded dataset {self.dataset_id}")

        runs = sorted(self.get_runs())
        if not runs:
            raise ValueError(f"Dataset {self.dataset_id} contains no runs to split")

        rng = random.Random(seed)
        shuffled = list(runs)
        rng.shuffle(shuffled)

        n_total = len(shuffled)
        n_test = max(1, int(round(n_total * test_ratio))) if test_ratio > 0 else 0
        n_val = max(1, int(round(n_total * val_ratio))) if val_ratio > 0 else 0

        # Boundary checks
        if n_test + n_val >= n_total:
            if n_total >= 3:
                n_test = 1
                n_val = 1
            elif n_total == 2:
                n_test = 1
                n_val = 0
            else:
                n_test = 0
                n_val = 0

        test_runs = sorted(shuffled[:n_test])
        val_runs = sorted(shuffled[n_test : n_test + n_val])
        train_runs = sorted(shuffled[n_test + n_val :])

        # Count records in each split
        train_count = sum(1 for r in self.iter_records() if r.run_id in set(train_runs))
        val_count = sum(1 for r in self.iter_records() if r.run_id in set(val_runs))
        test_count = sum(1 for r in self.iter_records() if r.run_id in set(test_runs))

        return DatasetSplit(
            dataset_id=self.dataset_id,
            strategy=strategy,
            random_seed=seed,
            train_runs=train_runs,
            val_runs=val_runs,
            test_runs=test_runs,
            train_count=train_count,
            val_count=val_count,
            test_count=test_count,
            metadata={
                "total_runs": n_total,
                "test_ratio_requested": test_ratio,
                "val_ratio_requested": val_ratio,
            },
        )
