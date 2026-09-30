"""ml_stub.py — Contract-complete deterministic fallback reasoner for stub mode."""

import sys
from pathlib import Path

_models_dir = str(Path(__file__).resolve().parent.parent / "models")
if _models_dir not in sys.path:
    sys.path.insert(0, _models_dir)

from ml.reasoner import reason_fallback


def reason(evidence: dict, history: list) -> dict:
    """Return a contract-complete diagnosis derived from rule-based classification."""
    return reason_fallback(
        evidence=evidence,
        history=history,
        error_note="Stub mode (rule-based reasoner)",
        stage="final",
    )
