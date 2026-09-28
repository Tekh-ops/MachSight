"""Unit tests for MachSight LLM reasoning engine with mocked HTTP calls.

Verifies:
1. Valid LLM response parses and normalizes correctly.
2. Request_more_data response normalizes correctly.
3. Malformed JSON on attempt 1 triggers retry with stricter prompt, succeeding on attempt 2.
4. Ollama timeout triggers deterministic reason_fallback().
5. Connection error triggers deterministic reason_fallback().
6. HTTP 500 error triggers deterministic reason_fallback().
7. All required schema keys are present across every code path.
8. Investigation history longer than 3 entries is summarized.
"""

import json
from unittest.mock import MagicMock, patch
import httpx
import pytest

from ml.reasoner import reason, reason_fallback

REQUIRED_KEYS = {
    "action",
    "reasoning",
    "diagnosis",
    "confidence",
    "evidence_used",
    "recommended_action",
    "more_data",
    "severity",
    "ui_hints",
}


@pytest.fixture
def sample_evidence():
    """Provides a realistic sample evidence payload."""
    return {
        "car_id": "car-01",
        "mode": "forward",
        "pwm": 200,
        "bucket": "forward:200",
        "telemetry": {
            "current_a": 6.0,
            "current_baseline": 1.75,
            "current_z": 53.12,
            "rpm": 20.0,
            "rpm_baseline": 305.0,
            "rpm_z": -35.62,
            "ratio": 0.3,
            "ratio_baseline": 0.0057,
            "distance_cm": 85.0,
            "distance_plausible": True,
        },
        "anomaly": {
            "is_anomaly": True,
            "score": 53.12,
            "reasons": ["Motor current (6.00A) is 242.9% above baseline mean (1.75A)"],
        },
        "top_matches": [
            {
                "fault": "obstruction_jam",
                "score": 0.95,
                "matched": [
                    "Motor current z-score (+53.12) >= 3.0 indicates severe overcurrent / stall draw",
                    "Wheel RPM z-score (-35.62) <= -2.0 indicates wheel lockup / near-zero rotation",
                    "Ultrasonic distance (85.0 cm) indicates clear path ahead, ruling out obstacle collision",
                ],
            }
        ],
        "window_stats": {
            "samples": 5,
            "current_mean": 5.95,
            "rpm_mean": 21.0,
            "pct_anomalous": 100.0,
            "current_slope": 0.01,
            "rpm_slope": -0.02,
        },
    }


def test_reason_valid_llm_diagnose(sample_evidence):
    """Verifies that a valid diagnose response from Ollama is parsed and normalized correctly."""
    mock_llm_content = {
        "action": "diagnose",
        "reasoning": "Extreme motor stall current with near-zero RPM while path is clear confirms mechanical drivetrain jam.",
        "diagnosis": "Mechanical obstruction / drivetrain jam",
        "confidence": 0.95,
        "evidence_used": ["current_a: 6.0A (z=+53.12)", "rpm: 20.0 (z=-35.62)", "distance: 85cm"],
        "recommended_action": "Cut motor power immediately; check gears and wheel hubs for mechanical bind.",
        "more_data": None,
        "severity": "critical",
        "ui_hints": {
            "highlight_metrics": ["current_a", "rpm"],
            "suggested_charts": ["current_timeline", "rpm_timeline"],
        },
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "message": {"content": json.dumps(mock_llm_content)}
    }

    with patch("httpx.Client.post", return_value=mock_resp):
        res = reason(sample_evidence, history=[])

    assert res["action"] == "diagnose"
    assert res["diagnosis"] == "Mechanical obstruction / drivetrain jam"
    assert res["confidence"] == 0.95
    assert "drivetrain jam" in res["reasoning"].lower()
    assert REQUIRED_KEYS.issubset(res.keys())
    assert "highlight_metrics" in res["ui_hints"]


def test_reason_valid_llm_request_more_data(sample_evidence):
    """Verifies that an action='request_more_data' response normalizes properly."""
    mock_llm_content = {
        "action": "request_more_data",
        "reasoning": "Single elevated current spike observed; window telemetry is required to verify persistence.",
        "diagnosis": None,
        "confidence": None,
        "evidence_used": ["current_a: 6.0A"],
        "recommended_action": None,
        "more_data": {"seconds": 2, "focus": "current"},
        "severity": "warning",
        "ui_hints": {
            "highlight_metrics": ["current_a"],
            "suggested_charts": ["current_timeline"],
        },
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "message": {"content": json.dumps(mock_llm_content)}
    }

    with patch("httpx.Client.post", return_value=mock_resp):
        res = reason(sample_evidence, history=[])

    assert res["action"] == "request_more_data"
    assert res["diagnosis"] is None
    assert res["confidence"] is None
    assert res["more_data"] == {"seconds": 2, "focus": "current"}
    assert REQUIRED_KEYS.issubset(res.keys())


def test_reason_malformed_then_retry_success(sample_evidence):
    """Verifies that malformed JSON on attempt 1 triggers retry with stricter prompt, succeeding on attempt 2."""
    valid_content = {
        "action": "diagnose",
        "reasoning": "Recovered valid diagnosis after retry.",
        "diagnosis": "Mechanical drag",
        "confidence": 0.88,
        "evidence_used": ["current_rpm_ratio"],
        "recommended_action": "Lubricate bearings",
        "more_data": None,
        "severity": "warning",
        "ui_hints": {
            "highlight_metrics": ["current_rpm_ratio"],
            "suggested_charts": ["ratio_timeline"],
        },
    }

    resp_bad = MagicMock()
    resp_bad.status_code = 200
    resp_bad.json.return_value = {"message": {"content": "INVALID_JSON_HERE"}}

    resp_good = MagicMock()
    resp_good.status_code = 200
    resp_good.json.return_value = {"message": {"content": json.dumps(valid_content)}}

    with patch("httpx.Client.post", side_effect=[resp_bad, resp_good]) as mock_post:
        res = reason(sample_evidence, history=[])

        assert mock_post.call_count == 2
        # Check that attempt 2 appended the stricter retry instruction
        retry_call_args = mock_post.call_args_list[1]
        retry_body = retry_call_args[1]["json"]
        assert len(retry_body["messages"]) > 2
        assert "CRITICAL ERROR: Your previous response was invalid" in retry_body["messages"][-1]["content"]

    assert res["action"] == "diagnose"
    assert res["diagnosis"] == "Mechanical drag"
    assert res["confidence"] == 0.88


def test_reason_timeout_triggers_fallback(sample_evidence):
    """Verifies that an Ollama timeout cleanly invokes reason_fallback without crashing."""
    with patch("httpx.Client.post", side_effect=httpx.TimeoutException("Read timed out")):
        res = reason(sample_evidence, history=[])

    assert res["action"] == "diagnose"
    assert "Fallback" in res["reasoning"]
    assert res["diagnosis"] == "Mechanical obstruction / drivetrain jam detected"
    assert res["confidence"] == 0.95
    assert REQUIRED_KEYS.issubset(res.keys())


def test_reason_connection_error_triggers_fallback(sample_evidence):
    """Verifies that a connection refused error cleanly invokes reason_fallback."""
    with patch("httpx.Client.post", side_effect=httpx.ConnectError("Connection refused")):
        res = reason(sample_evidence, history=[])

    assert res["action"] == "diagnose"
    assert "Fallback" in res["reasoning"]
    assert res["confidence"] == 0.95
    assert REQUIRED_KEYS.issubset(res.keys())


def test_reason_http_500_triggers_fallback(sample_evidence):
    """Verifies that an HTTP 500 error from Ollama cleanly invokes reason_fallback."""
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Server Error"

    with patch("httpx.Client.post", return_value=mock_resp):
        res = reason(sample_evidence, history=[])

    assert res["action"] == "diagnose"
    assert "Ollama HTTP 500" in res["reasoning"]
    assert res["confidence"] == 0.95
    assert REQUIRED_KEYS.issubset(res.keys())


def test_reason_fallback_low_confidence_requests_more_data(sample_evidence):
    """Verifies that reason_fallback requests more data if top match score < 0.60 on initial hop."""
    low_conf_evidence = dict(sample_evidence)
    low_conf_evidence["top_matches"] = [{"fault": "mechanical_drag", "score": 0.45, "matched": ["Ratio +32%"]}]

    res = reason_fallback(low_conf_evidence, history=[])
    assert res["action"] == "request_more_data"
    assert res["diagnosis"] is None
    assert res["confidence"] is None
    assert res["more_data"]["seconds"] == 2
    assert REQUIRED_KEYS.issubset(res.keys())


def test_schema_keys_present_in_every_path(sample_evidence):
    """Ensures every execution path returns all required fields defined in the reasoner contract."""
    # Path 1: Fallback with jam
    res1 = reason_fallback(sample_evidence, history=[])
    assert REQUIRED_KEYS.issubset(res1.keys())

    # Path 2: Fallback with sensor fault
    sensor_ev = dict(sample_evidence)
    sensor_ev["top_matches"] = [{"fault": "sensor_fault", "score": 0.96, "matched": ["Distance out of range"]}]
    res2 = reason_fallback(sensor_ev, history=[])
    assert REQUIRED_KEYS.issubset(res2.keys())

    # Path 3: Fallback with healthy
    healthy_ev = dict(sample_evidence)
    healthy_ev["top_matches"] = [{"fault": "healthy", "score": 0.95, "matched": ["All nominal"]}]
    res3 = reason_fallback(healthy_ev, history=[])
    assert REQUIRED_KEYS.issubset(res3.keys())


def test_history_summarization_longer_than_three_entries(sample_evidence):
    """Verifies that history longer than 3 entries is summarized rather than dumped verbatim."""
    history = [
        {"action": "request_more_data", "reasoning": "Need current data", "more_data": {"seconds": 2, "focus": "current"}},
        {"action": "request_more_data", "reasoning": "Need rpm data", "more_data": {"seconds": 2, "focus": "rpm"}},
        {"action": "request_more_data", "reasoning": "Need distance data", "more_data": {"seconds": 2, "focus": "distance"}},
        {"action": "request_more_data", "reasoning": "Checking stability", "more_data": {"seconds": 1, "focus": "current"}},
    ]

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "message": {
            "content": json.dumps({
                "action": "diagnose",
                "reasoning": "Diagnosed after multi-hop investigation.",
                "diagnosis": "Mechanical drag",
                "confidence": 0.90,
                "evidence_used": ["current_a"],
                "recommended_action": "Inspect",
                "more_data": None,
                "severity": "warning",
                "ui_hints": {"highlight_metrics": ["current_a"], "suggested_charts": ["current_timeline"]},
            })
        }
    }

    with patch("httpx.Client.post", return_value=mock_resp) as mock_post:
        reason(sample_evidence, history=history)

        sent_body = mock_post.call_args[1]["json"]
        user_content = sent_body["messages"][1]["content"]

        # Ensure summary of older entries is present
        assert "Prior 2 steps" in user_content
        assert "inconclusive" in user_content
        # Ensure latest 2 steps are preserved
        assert "Step 3" in user_content
        assert "Step 4" in user_content
