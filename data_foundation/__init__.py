"""MachSight Data Foundation Layer.

Production data foundation for industrial dataset ingestion, normalization,
data quality auditing, leakage prevention, fault taxonomy mapping, and task-specific view extraction.
"""

from data_foundation.schemas import (
    DiagnosticTask,
    SplitStrategy,
    SensorMeta,
    OperatingCondition,
    FaultState,
    NormalizedRecord,
    DatasetManifest,
    DataQualityReport,
    DatasetSplit,
)
from data_foundation.taxonomy import FaultTaxonomy
from data_foundation.adapter import IndustrialDatasetAdapter
from data_foundation.registry import DatasetRegistry
from data_foundation.validators import DatasetValidator
from data_foundation.leakage import LeakageDetector
from data_foundation.preprocessor import Preprocessor
from data_foundation.task_views import (
    AnomalyDetectionView,
    FaultClassificationView,
    TaskViewExtractor,
)
from data_foundation.adapters.cwru_bearing import CWRUBearingAdapter
from data_foundation.adapters.mcsadc_rotor import MCSADCRotorAdapter
from data_foundation.adapters.electric_motor_temp import ElectricMotorTempAdapter

# Auto-register standard industrial adapters
DatasetRegistry.register(CWRUBearingAdapter)
DatasetRegistry.register(MCSADCRotorAdapter)
DatasetRegistry.register(ElectricMotorTempAdapter)

__all__ = [
    "DiagnosticTask",
    "SplitStrategy",
    "SensorMeta",
    "OperatingCondition",
    "FaultState",
    "NormalizedRecord",
    "DatasetManifest",
    "DataQualityReport",
    "DatasetSplit",
    "FaultTaxonomy",
    "IndustrialDatasetAdapter",
    "DatasetRegistry",
    "DatasetValidator",
    "LeakageDetector",
    "Preprocessor",
    "AnomalyDetectionView",
    "FaultClassificationView",
    "TaskViewExtractor",
    "CWRUBearingAdapter",
    "MCSADCRotorAdapter",
    "ElectricMotorTempAdapter",
]
