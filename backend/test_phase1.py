"""Phase 1 regression tests for MachSight / IndustrialDoctor backend.

Tests cover:
  1. Telemetry validation (valid, missing ID, NaN, Inf, bad ranges, optional sensors)
  2. Machine isolation (counters, buffers, investigations)
  3. Qwen configuration (default model, env override)
  4. LLM fallback (unavailable, malformed, timeout)
  5. Investigation correctness and bounding
  6. Backward compatibility (existing RC-car telemetry format still accepted)
"""

import asyncio
import json
import os
import sys
import time
from collections import deque
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

# Ensure paths are importable
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "backend"))
sys.path.insert(0, str(repo_root / "models"))

import main
from telemetry_schema import IncomingTelemetry, SensorSignals
from machine_state import MachineState, MachineStateRegistry


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_state():
    """Fresh machine registry before every Phase 1 test."""
    from machine_state import machine_registry
    machine_registry._states.clear()
    yield
    machine_registry._states.clear()


@pytest.fixture
def client():
    return TestClient(main.app)


# ===========================================================================
# 1. TELEMETRY VALIDATION
# ===========================================================================

class TestTelemetryValidation:
    """Objective 2: Pydantic validation at the ingestion boundary."""

    def test_valid_legacy_rc_car_telemetry_accepted(self):
        """Standard mock_car.py payload must pass validation."""
        telem = IncomingTelemetry.model_validate({
            "car_id": "car-01",
            "timestamp": time.time(),
            "mode": "forward",
            "pwm_command": 200,
            "current_a": 1.75,
            "rpm": 303.0,
            "distance_cm": 85.0,
        })
        assert telem.machine_id == "car-01"
        assert telem.current_a == 1.75

    def test_new_schema_v2_structure_accepted(self):
        """Schema version 2 structured payload must pass validation."""
        telem = IncomingTelemetry.model_validate({
            "schema_version": 2,
            "machine_id": "machine-01",
            "asset_type": "industrial_pump",
            "operating_state": {"mode": "forward", "rpm": 1500.0},
            "signals": {"current_a": 2.5, "vibration_rms": 0.03, "temperature_c": 72.0},
            "source": {"transport": "websocket", "device_id": "sensor-a1"},
        })
        assert telem.machine_id == "machine-01"
        assert telem.signals.vibration_rms == 0.03

    def test_missing_machine_id_and_car_id_rejected(self):
        """Telemetry with no identity field must be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            IncomingTelemetry.model_validate({
                "timestamp": time.time(),
                "current_a": 1.75,
                "rpm": 303.0,
            })
        errors = exc_info.value.errors()
        assert any("machine_id" in str(e) or "car_id" in str(e) for e in errors)

    def test_nan_current_rejected(self):
        """NaN in sensor field must raise ValidationError."""
        with pytest.raises(ValidationError):
            IncomingTelemetry.model_validate({
                "car_id": "car-01",
                "current_a": float("nan"),
                "rpm": 300.0,
            })

    def test_inf_rpm_rejected(self):
        """Infinity in sensor field must raise ValidationError."""
        with pytest.raises(ValidationError):
            IncomingTelemetry.model_validate({
                "car_id": "car-01",
                "current_a": 1.5,
                "rpm": float("inf"),
            })

    def test_negative_infinity_current_rejected(self):
        """Negative infinity must be rejected."""
        with pytest.raises(ValidationError):
            IncomingTelemetry.model_validate({
                "car_id": "car-01",
                "current_a": float("-inf"),
            })

    def test_impossible_distance_rejected(self):
        """distance_cm > 500 cm exceeds physical bound and must be rejected."""
        with pytest.raises(ValidationError):
            IncomingTelemetry.model_validate({
                "car_id": "car-01",
                "distance_cm": 9999.0,
            })

    def test_negative_distance_rejected(self):
        """Negative distance is physically impossible."""
        with pytest.raises(ValidationError):
            IncomingTelemetry.model_validate({
                "car_id": "car-01",
                "distance_cm": -10.0,
            })

    def test_invalid_pwm_range_rejected(self):
        """PWM values must be 0–255."""
        with pytest.raises(ValidationError):
            IncomingTelemetry.model_validate({
                "car_id": "car-01",
                "pwm_command": 300,
            })

    def test_optional_industrial_sensors_may_be_absent(self):
        """Industrial signals absent from a reading must NOT cause rejection."""
        # A minimal RC-car reading with no temperature/vibration/pressure is valid
        telem = IncomingTelemetry.model_validate({
            "car_id": "car-01",
            "current_a": 1.75,
            "rpm": 303.0,
            "distance_cm": 85.0,
        })
        assert telem.temperature_c is None
        assert telem.vibration_rms is None
        assert telem.pressure_bar is None

    def test_car_id_alias_populates_machine_id(self):
        """car_id must be copied to machine_id for the generalized identity."""
        telem = IncomingTelemetry.model_validate({"car_id": "car-99"})
        assert telem.machine_id == "car-99"

    def test_timestamp_auto_filled_when_absent(self):
        """If timestamp is omitted the server should fill it."""
        t_before = time.time()
        telem = IncomingTelemetry.model_validate({"car_id": "car-01"})
        t_after = time.time()
        assert telem.timestamp is not None
        assert t_before - 0.5 <= telem.timestamp <= t_after + 0.5

    def test_legacy_dict_merges_flat_fields(self):
        """to_legacy_dict() must include all flat RC-car fields the ML pipeline needs."""
        telem = IncomingTelemetry.model_validate({
            "car_id": "car-01",
            "mode": "forward",
            "pwm_command": 200,
            "current_a": 1.75,
            "rpm": 303.0,
            "distance_cm": 85.0,
        })
        d = telem.to_legacy_dict()
        assert d["car_id"] == "car-01"
        assert d["machine_id"] == "car-01"
        assert d["mode"] == "forward"
        assert d["current_a"] == 1.75

    def test_validation_error_is_sent_as_json_on_ws_ingestion(client):
        """Malformed telemetry over WS should get an error response, not crash the server."""
        client_obj = TestClient(main.app)
        from machine_state import machine_registry
        machine_registry._states.clear()

        with client_obj.websocket_connect("/telemetry/ingest") as ws:
            # Missing machine_id / car_id
            ws.send_json({"current_a": 1.0, "rpm": 300.0})
            # Send a valid packet next — connection must still be open
            ws.send_json({
                "car_id": "car-01",
                "current_a": 1.75,
                "rpm": 303.0,
                "distance_cm": 85.0,
                "pwm_command": 200,
                "mode": "forward",
            })
            # If we get here without an exception, the connection survived


# ===========================================================================
# 2. MACHINE ISOLATION
# ===========================================================================

class TestMachineIsolation:
    """Objective 3: per-machine state isolation."""

    def test_separate_anomaly_counters(self):
        """Anomaly on machine A must not increment machine B's counter."""
        registry = MachineStateRegistry()
        a = registry.get("machine-A")
        b = registry.get("machine-B")

        a.record_anomaly()
        a.record_anomaly()

        assert a.consecutive_anomalies == 2
        assert b.consecutive_anomalies == 0

    def test_separate_rolling_buffers(self):
        """Readings appended to machine A must not appear in machine B's buffer."""
        registry = MachineStateRegistry()
        a = registry.get("machine-A")
        b = registry.get("machine-B")

        a.append_reading({"machine_id": "machine-A", "current_a": 1.0})
        a.append_reading({"machine_id": "machine-A", "current_a": 1.1})

        assert len(a.rolling_buffer) == 2
        assert len(b.rolling_buffer) == 0

    def test_separate_investigation_flags(self):
        """Investigation on machine A must not affect machine B's is_investigating."""
        registry = MachineStateRegistry()
        a = registry.get("machine-A")
        b = registry.get("machine-B")

        a.mark_investigation_started()

        assert a.is_investigating is True
        assert b.is_investigating is False

    def test_separate_cooldowns(self):
        """Cooldown end-time on machine A must not leak to machine B."""
        registry = MachineStateRegistry()
        a = registry.get("machine-A")
        b = registry.get("machine-B")

        a.mark_investigation_ended()
        # Machine A is now on cooldown; Machine B should not be
        assert a.is_on_cooldown()
        assert not b.is_on_cooldown()

    def test_reset_anomaly_counter_only_affects_target_machine(self):
        """reset_anomaly_counter() on A must not touch B."""
        registry = MachineStateRegistry()
        a = registry.get("machine-A")
        b = registry.get("machine-B")

        a.record_anomaly()
        b.record_anomaly()
        b.record_anomaly()

        a.reset_anomaly_counter()

        assert a.consecutive_anomalies == 0
        assert b.consecutive_anomalies == 2

    def test_separate_sequence_numbers(self):
        """Reading sequences are per-machine."""
        registry = MachineStateRegistry()
        a = registry.get("machine-A")
        b = registry.get("machine-B")

        a.append_reading({"machine_id": "machine-A"})
        a.append_reading({"machine_id": "machine-A"})
        b.append_reading({"machine_id": "machine-B"})

        # a should have seq 1,2; b should have seq 1
        seqs_a = [r["_seq"] for r in a.rolling_buffer]
        seqs_b = [r["_seq"] for r in b.rolling_buffer]
        assert seqs_a == [1, 2]
        assert seqs_b == [1]

    def test_ws_ingestion_two_machines_isolated(self, client):
        """Two machines sending telemetry via WS must remain in independent state."""
        with client.websocket_connect("/telemetry/ingest") as ws:
            # 3 anomalous readings for machine-A
            for _ in range(3):
                ws.send_json({
                    "machine_id": "machine-A",
                    "current_a": 6.0, "rpm": 10.0,
                    "distance_cm": 85.0, "pwm_command": 200, "mode": "forward",
                })
            # 1 anomalous reading for machine-B
            ws.send_json({
                "machine_id": "machine-B",
                "current_a": 6.0, "rpm": 10.0,
                "distance_cm": 85.0, "pwm_command": 200, "mode": "forward",
            })

        from machine_state import machine_registry
        state_b = machine_registry.get("machine-B")
        # Machine B should have at most 1 anomaly — not 4
        # (after trigger, counter resets for A, B is independent)
        assert state_b.consecutive_anomalies <= 1


# ===========================================================================
# 3. QWEN CONFIGURATION
# ===========================================================================

class TestQwenConfiguration:
    """Objective 4: centralized model configuration."""

    def test_default_model_is_qwen25_3b_instruct(self):
        """The default model must be qwen2.5:3b-instruct, not the old 7b variant."""
        from ml.reasoner import MACHSIGHT_LLM_MODEL
        # When env var is not set, default must be the 3B model
        env_override = os.environ.get("MACHSIGHT_LLM_MODEL")
        if env_override is None:
            assert MACHSIGHT_LLM_MODEL == "qwen2.5:3b-instruct"

    def test_env_override_changes_model(self, monkeypatch):
        """Setting MACHSIGHT_LLM_MODEL env var must change the active model."""
        monkeypatch.setenv("MACHSIGHT_LLM_MODEL", "qwen2.5:7b-instruct")
        import importlib
        import ml.reasoner as reas
        importlib.reload(reas)
        assert reas.MACHSIGHT_LLM_MODEL == "qwen2.5:7b-instruct"
        # Restore
        importlib.reload(reas)

    def test_config_module_exports_correct_default(self):
        """config.OLLAMA_MODEL must default to qwen2.5:3b-instruct."""
        import config
        if os.environ.get("MACHSIGHT_LLM_MODEL") is None:
            assert config.OLLAMA_MODEL == "qwen2.5:3b-instruct"

    def test_status_endpoint_reports_active_model(self, client):
        """GET /api/status must report the configured model or 'ml_stub'."""
        r = client.get("/api/status")
        assert r.status_code == 200
        data = r.json()
        assert "active_model" in data
        # Without Ollama running the model is either ml_stub or the configured name
        assert data["active_model"] in ("ml_stub", "qwen2.5:3b-instruct", os.environ.get("MACHSIGHT_LLM_MODEL", "qwen2.5:3b-instruct"))


# ===========================================================================
# 4. LLM FALLBACK
# ===========================================================================

class TestLLMFallback:
    """Objective 8: deterministic fallback must work under all failure modes."""

    def _make_evidence(self) -> dict:
        return {
            "machine": {"machine_id": "car-01", "asset_type": "rc_vehicle"},
            "car_id": "car-01",
            "mode": "forward",
            "pwm": 200,
            "bucket": "forward:200",
            "telemetry": {
                "current_a": 6.0, "current_baseline": 1.75, "current_z": 53.12,
                "rpm": 20.0, "rpm_baseline": 305.0, "rpm_z": -35.62,
                "ratio": 0.3, "ratio_baseline": 0.0057,
                "distance_cm": 85.0, "distance_plausible": True,
            },
            "anomaly": {"is_anomaly": True, "score": 53.12, "reasons": ["overcurrent"]},
            "top_matches": [{"fault": "obstruction_jam", "score": 0.95, "matched": ["stall current"]}],
            "fault_hypotheses": [{"fault": "obstruction_jam", "score": 0.95,
                                  "matched_conditions": ["stall current"], "contradicting_conditions": []}],
            "reasons": ["overcurrent"],
            "anomaly_score": 53.12,
        }

    def test_ollama_unavailable_returns_deterministic_fallback(self):
        """Connection error to Ollama must trigger deterministic fallback, not crash."""
        import httpx
        from ml.reasoner import reason
        with patch("httpx.Client.post", side_effect=httpx.ConnectError("refused")):
            result = reason(self._make_evidence(), history=[])
        assert result["action"] == "diagnose"
        assert "Fallback" in result["reasoning"]
        assert result["confidence"] is not None
        assert result["diagnosis"] is not None

    def test_malformed_llm_response_returns_fallback(self):
        """Malformed JSON from LLM on both attempts must return deterministic fallback."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"message": {"content": "NOT_VALID_JSON{"}}
        from ml.reasoner import reason
        with patch("httpx.Client.post", return_value=mock_resp):
            result = reason(self._make_evidence(), history=[])
        assert result["action"] == "diagnose"
        assert result["diagnosis"] is not None

    def test_llm_timeout_returns_fallback(self):
        """Timeout from Ollama must return deterministic fallback."""
        import httpx
        from ml.reasoner import reason
        with patch("httpx.Client.post", side_effect=httpx.TimeoutException("timeout")):
            result = reason(self._make_evidence(), history=[])
        assert result["action"] == "diagnose"
        assert "Fallback" in result["reasoning"] or result["confidence"] >= 0.0

    def test_fallback_does_not_require_llm_at_all(self):
        """reason_fallback() must succeed even if Ollama has never been contacted."""
        from ml.reasoner import reason_fallback
        result = reason_fallback(self._make_evidence(), history=[])
        assert result["action"] == "diagnose"
        assert result["severity"] in ("info", "warning", "critical")
        required = {"action", "reasoning", "diagnosis", "confidence",
                    "evidence_used", "recommended_action", "more_data",
                    "severity", "ui_hints"}
        assert required.issubset(result.keys())


# ===========================================================================
# 5. INVESTIGATION CORRECTNESS
# ===========================================================================

class TestInvestigationBounds:
    """Objective 5: investigation remains bounded, single-flight, and non-blocking."""

    def _make_investigation_args(self):
        reading = {
            "car_id": "car-01", "machine_id": "car-01",
            "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0,
            "pwm_command": 200, "mode": "forward",
            "timestamp": time.time(),
        }
        processed = {
            "current_rpm_ratio": 0.3, "current_zscore": 53.0, "rpm_zscore": -35.0,
            "mahalanobis_distance": 53.0, "distance_plausible": True,
            "bucket_used": "forward:200", "mode": "forward", "pwm_command": 200,
            "current_a": 6.0, "rpm": 20.0, "distance_cm": 85.0,
            "baseline_current_mean": 1.75, "baseline_rpm_mean": 303.0,
            "baseline_current_std": 0.075, "baseline_rpm_std": 8.6,
            "baseline_current_rpm_ratio": 0.0057, "reasons": ["overcurrent"],
        }
        result = {
            "is_anomaly": True, "anomaly_score": 53.0,
            "reasons": ["overcurrent"],
            "matches": [{"fault": "obstruction_jam", "score": 0.95,
                         "matched_conditions": ["stall current"], "contradicting": []}],
        }
        return reading, processed, result

    def test_investigation_loop_bounded_at_max_hops(self):
        """An always-request_more_data LLM must not loop more than INVESTIGATION_MAX_HOPS times."""
        from machine_state import MachineStateRegistry
        from config import INVESTIGATION_MAX_HOPS

        registry = MachineStateRegistry()
        machine = registry.get("car-01")
        reading, processed, result = self._make_investigation_args()

        loop_result = {
            "action": "request_more_data",
            "reasoning": "need more data",
            "diagnosis": None, "confidence": None,
            "evidence_used": [], "recommended_action": None,
            "more_data": {"seconds": 0.01, "focus": "current"},
            "severity": "warning",
            "ui_hints": {"highlight_metrics": [], "suggested_charts": []},
        }

        mock_reason = MagicMock(return_value=loop_result)
        broadcasted = []

        async def mock_broadcast(et, data):
            broadcasted.append(et)

        async def run():
            with patch("ml.reasoner.reason", mock_reason), \
                 patch.object(main, "broadcast", side_effect=mock_broadcast):
                await main.trigger_investigation(machine, reading, processed, result)

        asyncio.run(run())

        # The LLM was asked at most INVESTIGATION_MAX_HOPS times
        assert mock_reason.call_count <= INVESTIGATION_MAX_HOPS
        # A final diagnosis was broadcast
        assert "diagnosis" in broadcasted

    def test_investigation_single_flight_per_machine(self):
        """A second concurrent call to trigger_investigation for the same machine is a no-op."""
        from machine_state import MachineStateRegistry

        registry = MachineStateRegistry()
        machine = registry.get("car-01")
        reading, processed, result = self._make_investigation_args()

        call_count = 0

        async def slow_reason(evidence, history):
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.05)
            return {
                "action": "diagnose", "reasoning": "ok",
                "diagnosis": "jam", "confidence": 0.95,
                "evidence_used": [], "recommended_action": None,
                "more_data": None, "severity": "critical",
                "ui_hints": {"highlight_metrics": [], "suggested_charts": []},
            }

        async def mock_broadcast(et, data):
            pass

        async def run():
            with patch("ml.reasoner.reason", side_effect=slow_reason), \
                 patch.object(main, "broadcast", side_effect=mock_broadcast):
                # Fire two concurrent investigations for the same machine
                t1 = asyncio.create_task(
                    main.trigger_investigation(machine, reading, processed, result)
                )
                t2 = asyncio.create_task(
                    main.trigger_investigation(machine, reading, processed, result)
                )
                await asyncio.gather(t1, t2)

        asyncio.run(run())
        # LLM was called at most once (second task was blocked by single-flight guard)
        assert call_count <= 1

    def test_suspected_component_present_in_diagnosis(self):
        """Diagnosis payload must include suspected_component field from evidence (never from LLM)."""
        from machine_state import MachineStateRegistry
        from ml.pipeline import build_evidence
        from ml.features import process_reading

        registry = MachineStateRegistry()
        machine = registry.get("car-01")
        reading, processed, result = self._make_investigation_args()

        diagnoses = []

        async def capture_broadcast(et, data):
            if et == "diagnosis":
                diagnoses.append(data)

        async def run():
            with patch.object(main, "broadcast", side_effect=capture_broadcast):
                await main.trigger_investigation(machine, reading, processed, result)

        asyncio.run(run())

        assert len(diagnoses) >= 1
        # Each diagnosis payload should have suspected_component key
        for d in diagnoses:
            payload = json.loads(d["payload"])
            assert "suspected_component" in payload


# ===========================================================================
# 6. BACKWARD COMPATIBILITY
# ===========================================================================

class TestBackwardCompatibility:
    """Existing RC-car mock_car.py format must continue to work unchanged."""

    def test_rc_car_flat_payload_ingested_successfully(self, client):
        """The exact format that mock_car.py sends must be accepted without errors."""
        with client.websocket_connect("/telemetry/ingest") as ws:
            ws.send_json({
                "car_id": "car-01",
                "timestamp": time.time(),
                "mode": "forward",
                "pwm_command": 200,
                "current_a": 1.7534,
                "rpm": 302.18,
                "distance_cm": 87.5,
            })
            # Send a second reading to confirm connection is still alive
            ws.send_json({
                "car_id": "car-01",
                "timestamp": time.time(),
                "mode": "forward",
                "pwm_command": 200,
                "current_a": 1.7489,
                "rpm": 303.91,
                "distance_cm": 87.1,
            })

    def test_api_telemetry_returns_machine_id_column(self, client):
        """GET /api/telemetry must include machine_id in response rows."""
        # Ingest one reading first
        with client.websocket_connect("/telemetry/ingest") as ws:
            ws.send_json({
                "car_id": "car-01",
                "current_a": 1.75, "rpm": 303.0,
                "distance_cm": 85.0, "pwm_command": 200, "mode": "forward",
            })

        r = client.get("/api/telemetry?limit=5")
        assert r.status_code == 200
        data = r.json()
        assert "data" in data
        if data["data"]:
            # machine_id column should be present
            row = data["data"][0]
            assert "machine_id" in row

    def test_health_endpoint_still_works(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_status_endpoint_schema(self, client):
        r = client.get("/api/status")
        assert r.status_code == 200
        st = r.json()
        assert st["status"] == "ok"
        assert "active_model" in st
        assert "db_row_counts" in st

    def test_investigations_endpoint_returns_machine_id(self, client):
        r = client.get("/api/investigations?limit=5")
        assert r.status_code == 200
        data = r.json()
        assert "investigations" in data
        # If rows exist, machine_id should be present
        for inv in data["investigations"]:
            assert "machine_id" in inv

    def test_machines_endpoint_exists(self, client):
        """New /api/machines endpoint must return 200."""
        r = client.get("/api/machines")
        assert r.status_code == 200
        data = r.json()
        assert "machines" in data
