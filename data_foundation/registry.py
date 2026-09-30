"""MachSight Industrial Dataset Registry.

Central lookup and factory for registered industrial dataset adapters.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Type
from data_foundation.adapter import IndustrialDatasetAdapter
from data_foundation.schemas import DatasetManifest


class DatasetRegistry:
    """Registry maintaining available industrial dataset adapters."""

    _registry: Dict[str, Type[IndustrialDatasetAdapter]] = {}

    @classmethod
    def register(cls, adapter_cls: Type[IndustrialDatasetAdapter]) -> Type[IndustrialDatasetAdapter]:
        """Register an adapter class by its dataset_id."""
        # Instantiate temporarily to read dataset_id or check class attribute
        adapter_id = getattr(adapter_cls, "DATASET_ID", None)
        if not adapter_id:
            # Create dummy instance without path to inspect property
            try:
                inst = adapter_cls()
                adapter_id = inst.dataset_id
            except Exception:
                adapter_id = adapter_cls.__name__.lower().replace("adapter", "")

        cls._registry[adapter_id] = adapter_cls
        return adapter_cls

    @classmethod
    def get(cls, dataset_id: str, source_path: Optional[Path] = None) -> IndustrialDatasetAdapter:
        """Instantiate a registered adapter by ID."""
        if dataset_id not in cls._registry:
            raise KeyError(
                f"Dataset '{dataset_id}' not found in registry. "
                f"Available datasets: {sorted(list(cls._registry.keys()))}"
            )
        return cls._registry[dataset_id](source_path=source_path)

    @classmethod
    def list_datasets(cls) -> List[str]:
        """Return list of all registered dataset IDs."""
        return sorted(list(cls._registry.keys()))

    @classmethod
    def get_manifests(cls) -> Dict[str, DatasetManifest]:
        """Return manifests for all registered adapters."""
        manifests = {}
        for d_id, adapter_cls in cls._registry.items():
            try:
                inst = adapter_cls()
                manifests[d_id] = inst.manifest
            except Exception:
                pass
        return manifests

    @classmethod
    def clear(cls) -> None:
        """Clear registry (primarily for test isolation)."""
        cls._registry.clear()
