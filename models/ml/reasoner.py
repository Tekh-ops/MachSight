"""Local LLM Reasoning Engine for IndustrialDoctor RC Car Diagnosis.

Integrates with a local Ollama instance (qwen2.5:7b-instruct by default) using httpx,
enforcing structured JSON outputs, deterministic fallback on network or model failures,
and multi-hop reasoning with history summarization.
"""

import json
import logging
import os
from typing import Dict, Any, List, Optional, Tuple
import httpx

from .classify import FAULT_SIGNATURES

logger = logging.getLogger(__name__)

# Configuration with environment variable overrides
MACHSIGHT_LLM_MODEL = os.environ.get("MACHSIGHT_LLM_MODEL", "qwen2.5:7b-instruct")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MACHSIGHT_LLM_TIMEOUT = float(os.environ.get("MACHSIGHT_LLM_TIMEOUT", "45"))

# JSON schema for Ollama structured outputs (slimmed for speed on 8GB RAM)
REASONING_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["diagnose", "request_more_data"]
        },
        "reasoning": {
            "type": "string"
        },
        "diagnosis": {
            "type": ["string", "null"]
        },
        "confidence": {
            "type": ["number", "null"]
        },
        "recommended_action": {
            "type": ["string", "null"]
        },
        "more_data": {
            "type": ["object", "null"],
            "properties": {
                "seconds": {"type": "integer"},
                "focus": {
                    "type": "string",
                    "enum": ["current", "rpm", "distance"]
                }
            },
            "required": ["seconds", "focus"]
        }
    },
    "required": [
        "action",
        "reasoning",
        "diagnosis",
        "confidence",
        "recommended_action"
    ]
}

# Compile system prompt incorporating FAULT_SIGNATURES and few-shot examples
def _build_system_prompt() -> str:
    signatures_summary = []
    for fault_id, details in FAULT_SIGNATURES.items():
        indicators = "; ".join(details.get("indicators", []))
        signatures_summary.append(f"- {fault_id}: {details.get('title', fault_id)} — {details.get('description', '')} Indicators: {indicators}")
    sig_text = "\n".join(signatures_summary)

    return f"""You are MachSight Diagnostic Reasoner, an expert AI diagnosing an instrumented RC car.
You evaluate sensory evidence (motor current_a, wheel rpm, ultrasonic distance_cm, PWM command, operating mode).

FAULT SIGNATURES:
{sig_text}

CRITICAL RULES:
1. Only use the evidence given; NEVER invent readings or assume unmeasured values.
2. If evidence contains a decisive top rule match (score >= 0.85), diagnose immediately without requesting more data.
3. If confidence < 0.6 or evidence is ambiguous, set action="request_more_data".
4. When action="diagnose": diagnosis MUST be a descriptive diagnosis string and confidence MUST be 0.6-1.0.
5. When action="request_more_data": diagnosis=null, confidence=null, and specify more_data={{"seconds": int (1-5), "focus": "current"|"rpm"|"distance"}}.
6. Keep reasoning concise (EXACTLY 1 sentence, maximum 30 words).
7. Always return valid JSON conforming to the schema.

FEW-SHOT EXAMPLES:

Example 1 (Obstruction Jam):
Input:
{{"mode":"forward","pwm":200,"telemetry":{{"current_a":6.0,"current_z":53.1,"rpm":20.0,"rpm_z":-35.6,"distance_cm":85.0,"distance_plausible":true}},"top_matches":[{{"fault":"obstruction_jam","score":0.95}}]}}
Output:
{{"action":"diagnose","reasoning":"Extreme stall current (z=+53.1) with near-zero RPM while path is clear confirms a drivetrain jam.","diagnosis":"Mechanical obstruction / drivetrain jam","confidence":0.95,"recommended_action":"Cut motor PWM power immediately; clear drivetrain and check gear mesh."}}

Example 2 (Ambiguous Reading / Request More Data):
Input:
{{"mode":"forward","pwm":150,"telemetry":{{"current_a":1.65,"current_z":2.1,"rpm":160.0,"rpm_z":-1.8,"distance_cm":75.0,"distance_plausible":true}},"top_matches":[{{"fault":"mechanical_drag","score":0.55}}],"window_stats":null}}
Output:
{{"action":"request_more_data","reasoning":"Current/RPM ratio is elevated, but window data is needed to verify if friction is sustained.","diagnosis":null,"confidence":null,"recommended_action":null,"more_data":{{"seconds":2,"focus":"current"}}}}

Example 3 (Sensor Fault):
Input:
{{"mode":"forward","pwm":150,"telemetry":{{"current_a":1.25,"current_z":0.0,"rpm":210.0,"rpm_z":0.0,"distance_cm":999.0,"distance_plausible":false}},"top_matches":[{{"fault":"sensor_fault","score":0.96}}]}}
Output:
{{"action":"diagnose","reasoning":"Ultrasonic distance of 999.0cm exceeds physical limit while drive telemetry is nominal.","diagnosis":"Ultrasonic distance sensor failure","confidence":0.96,"recommended_action":"Inspect HC-SR04 sensor wiring and mounting."}}
"""

SYSTEM_PROMPT = _build_system_prompt()


def _format_history(history: List[Dict[str, Any]]) -> str:
    """Formats investigation history, summarizing entries if length exceeds 3."""
    if not history:
        return "None (first investigation step)."

    if len(history) <= 3:
        lines = []
        for i, h in enumerate(history):
            action = h.get("action", "unknown")
            reasoning = h.get("reasoning", "")
            more_data = h.get("more_data")
            focus = f" (focus: {more_data.get('focus')}, duration: {more_data.get('seconds')}s)" if more_data else ""
            lines.append(f"Step {i+1}: action='{action}'{focus}, reasoning: {reasoning}")
        return "\n".join(lines)

    # Summarize older entries, keeping latest 2 verbatim
    older = history[:-2]
    foci = set(
        h.get("more_data", {}).get("focus")
        for h in older
        if isinstance(h.get("more_data"), dict) and h.get("more_data", {}).get("focus")
    )
    foci_str = f" focused on {', '.join(foci)}" if foci else ""
    summary_line = f"Prior {len(older)} steps{foci_str} inconclusive."

    recent_lines = []
    for i, h in enumerate(history[-2:], start=len(older) + 1):
        action = h.get("action", "unknown")
        reasoning = h.get("reasoning", "")
        recent_lines.append(f"Step {i}: action='{action}', reasoning: {reasoning}")

    return f"{summary_line}\n" + "\n".join(recent_lines)


def _validate_response_schema(res: Any) -> Tuple[bool, str]:
    """Validates that parsed LLM output strictly conforms to the expected contract."""
    if not isinstance(res, dict):
        return False, "Response is not a JSON object"

    action = res.get("action")
    if action not in ("diagnose", "request_more_data"):
        return False, f"Invalid action: {action}"

    if not isinstance(res.get("reasoning"), str) or not res.get("reasoning", "").strip():
        return False, "Missing or empty reasoning string"

    if action == "diagnose":
        if not isinstance(res.get("diagnosis"), str) or not res.get("diagnosis", "").strip():
            return False, "Diagnose action requires non-empty diagnosis string"
        conf = res.get("confidence")
        if not isinstance(conf, (int, float)) or not (0.0 <= float(conf) <= 1.0):
            return False, f"Diagnose action requires confidence between 0.0 and 1.0, got {conf}"

    if action == "request_more_data":
        more = res.get("more_data")
        if more is not None and isinstance(more, dict):
            if "focus" in more and more["focus"] not in ("current", "rpm", "distance"):
                return False, f"Invalid more_data focus: {more.get('focus')}"

    return True, ""


def _normalize_output(
    res: Dict[str, Any],
    evidence: Optional[Dict[str, Any]] = None,
    stage: str = "final"
) -> Dict[str, Any]:
    """Ensures all expected keys exist with appropriate types and defaults."""
    action = res.get("action", "diagnose")
    reasoning = str(res.get("reasoning", ""))
    diagnosis = res.get("diagnosis")
    confidence = float(res["confidence"]) if res.get("confidence") is not None else None

    # Handle request_more_data normalization
    more_data = res.get("more_data")
    if action == "request_more_data" and (not isinstance(more_data, dict) or not more_data):
        more_data = {"seconds": 2, "focus": "current"}
    elif action == "diagnose":
        more_data = None

    # Derive top rule match context if evidence provided
    top_matches = (
        evidence.get("top_rule_matches")
        or evidence.get("top_matches")
        or evidence.get("matches")
        or []
    ) if evidence else []
    top_match = top_matches[0] if top_matches else {}
    fault_type = top_match.get("fault", "unclassified_anomaly")
    matched_conditions = top_match.get("matched_conditions", top_match.get("matched", []))

    # Compute evidence_used in code if omitted by LLM
    evidence_used = res.get("evidence_used")
    if not evidence_used:
        if matched_conditions:
            evidence_used = list(matched_conditions[:3])
        elif evidence and evidence.get("reasons"):
            evidence_used = list(evidence.get("reasons", [])[:3])
        else:
            evidence_used = ["Telemetry feature deviations"]

    # Compute severity in code if omitted by LLM
    severity = res.get("severity")
    if severity not in ("info", "warning", "critical"):
        if fault_type == "obstruction_jam" or (confidence and confidence >= 0.85 and fault_type != "healthy"):
            severity = "critical"
        elif fault_type == "healthy":
            severity = "info"
        else:
            severity = "warning"

    # Compute ui_hints in code if omitted by LLM
    ui_hints = res.get("ui_hints")
    if not isinstance(ui_hints, dict):
        if fault_type == "mechanical_drag":
            ui_hints = {
                "highlight_metrics": ["current_rpm_ratio", "current_a", "rpm"],
                "suggested_charts": ["current_rpm_ratio_timeline", "current_timeline"],
            }
        elif fault_type == "obstruction_jam":
            ui_hints = {
                "highlight_metrics": ["current_a", "rpm", "distance_cm"],
                "suggested_charts": ["current_timeline", "rpm_timeline"],
            }
        elif fault_type == "sensor_fault":
            ui_hints = {
                "highlight_metrics": ["distance_cm"],
                "suggested_charts": ["distance_timeline"],
            }
        elif fault_type == "healthy":
            ui_hints = {
                "highlight_metrics": ["current_a", "rpm", "distance_cm"],
                "suggested_charts": ["telemetry_overview"],
            }
        else:
            ui_hints = {
                "highlight_metrics": ["current_a", "rpm"],
                "suggested_charts": ["current_timeline"],
            }
    else:
        ui_hints.setdefault("highlight_metrics", ["current_a", "rpm"])
        ui_hints.setdefault("suggested_charts", ["current_timeline"])

    return {
        "action": action,
        "reasoning": reasoning,
        "diagnosis": str(diagnosis) if diagnosis is not None else None,
        "confidence": round(confidence, 2) if confidence is not None else None,
        "evidence_used": list(evidence_used),
        "recommended_action": str(res["recommended_action"]) if res.get("recommended_action") else None,
        "more_data": more_data,
        "severity": severity,
        "ui_hints": {
            "highlight_metrics": list(ui_hints.get("highlight_metrics", [])),
            "suggested_charts": list(ui_hints.get("suggested_charts", [])),
        },
        "stage": stage,
    }


def reason_fallback(
    evidence: Dict[str, Any],
    history: List[Dict[str, Any]],
    error_note: str = "LLM offline/unreachable",
    stage: str = "final"
) -> Dict[str, Any]:
    """Produces a deterministic diagnosis from rule-based classification when LLM is unavailable.

    Guarantees the system never crashes or hangs, returning a fully compliant diagnosis
    with real confidence scores derived from the top rule match.

    Args:
        evidence: Compact evidence dictionary passed into reason().
        history: Accumulated multi-hop reasoning history.
        error_note: Diagnostic detail explaining why fallback was triggered.
        stage: Diagnostic stage ("preliminary" | "final").

    Returns:
        Structured diagnosis dictionary conforming to reason() contract.
    """
    top_matches = (
        evidence.get("top_rule_matches")
        or evidence.get("top_matches")
        or evidence.get("matches")
        or []
    )

    top = top_matches[0] if top_matches else {"fault": "unclassified_anomaly", "score": 0.70, "matched": []}
    fault_type = top.get("fault", "unclassified_anomaly")
    score = float(top.get("score", 0.70))
    matched_conditions = top.get("matched", top.get("matched_conditions", []))

    # Preliminary stage ALWAYS diagnoses immediately without looping
    if stage != "preliminary":
        # If confidence is low and this is the first hop, request more data
        if score < 0.60 and len(history) < 2:
            return {
                "action": "request_more_data",
                "reasoning": f"[Deterministic Fallback - {error_note}] Rule confidence ({score:.2f}) below diagnostic threshold; requesting additional window telemetry.",
                "diagnosis": None,
                "confidence": None,
                "evidence_used": matched_conditions[:2] if matched_conditions else ["Low baseline match score"],
                "recommended_action": None,
                "more_data": {"seconds": 2, "focus": "current"},
                "severity": "warning",
                "ui_hints": {
                    "highlight_metrics": ["current_a", "rpm"],
                    "suggested_charts": ["current_rpm_ratio_timeline"],
                },
                "stage": stage,
            }

    # Map fault types to canonical descriptions, severities, and actions
    if fault_type == "obstruction_jam":
        diagnosis = "Mechanical obstruction / drivetrain jam detected"
        severity = "critical"
        rec_action = "Cut motor PWM command immediately; clear drivetrain and check gear mesh."
        highlights = ["current_a", "rpm"]
        charts = ["current_timeline", "rpm_timeline"]
    elif fault_type == "mechanical_drag":
        diagnosis = "Mechanical drag / drivetrain friction resistance"
        severity = "warning"
        rec_action = "Inspect wheel bearings, axle alignment, and lubricate drivetrain components."
        highlights = ["current_rpm_ratio", "current_a"]
        charts = ["current_rpm_ratio_timeline"]
    elif fault_type == "sensor_fault":
        diagnosis = "Ultrasonic distance sensor failure / invalid reading"
        severity = "warning"
        rec_action = "Check ultrasonic sensor wiring, power rail, and mounting integrity."
        highlights = ["distance_cm"]
        charts = ["distance_timeline"]
    elif fault_type == "healthy":
        diagnosis = "Telemetry operates within healthy nominal baseline tolerances"
        severity = "info"
        rec_action = "Continue regular telemetry monitoring."
        highlights = ["current_a", "rpm", "distance_cm"]
        charts = ["telemetry_overview"]
    else:
        diagnosis = f"Telemetry anomaly flagged: {fault_type}"
        severity = "warning"
        rec_action = "Inspect vehicle mechanics and check sensor calibration."
        highlights = ["current_a", "rpm"]
        charts = ["anomaly_timeline"]

    cond_str = f" Conditions: {'; '.join(matched_conditions[:2])}" if matched_conditions else ""
    stage_prefix = "[Preliminary Match]" if stage == "preliminary" else f"[Deterministic Fallback - {error_note}]"
    reasoning = (
        f"{stage_prefix} Top rule classification identified '{fault_type}' "
        f"with confidence {score:.2f}.{cond_str}"
    )

    evidence_used = matched_conditions[:3] if matched_conditions else [f"Anomaly score: {evidence.get('anomaly_score', 'N/A')}"]

    return {
        "action": "diagnose",
        "reasoning": reasoning,
        "diagnosis": diagnosis,
        "confidence": round(score, 2),
        "evidence_used": evidence_used,
        "recommended_action": rec_action,
        "more_data": None,
        "severity": severity,
        "ui_hints": {
            "highlight_metrics": highlights,
            "suggested_charts": charts,
        },
        "stage": stage,
    }


def reason(
    evidence: Dict[str, Any],
    history: List[Dict[str, Any]],
    model: Optional[str] = None,
    ollama_url: Optional[str] = None,
    timeout: Optional[float] = None
) -> Dict[str, Any]:
    """Autonomous reasoning agent for RC car anomaly diagnosis.

    Evaluates telemetry evidence and multi-hop investigation history using local LLM
    (Ollama qwen2.5:3b-instruct / qwen2.5:7b-instruct), with structured outputs,
    prompt-level retry, and instantaneous deterministic fallback if the LLM is unavailable or times out.

    Args:
        evidence: Evidence dictionary containing telemetry, features, and top matches.
        history: List of previous reasoning result dictionaries from earlier loop iterations.
        model: Optional model override (defaults to MACHSIGHT_LLM_MODEL env or qwen2.5:7b-instruct).
        ollama_url: Optional Ollama URL override (defaults to OLLAMA_URL env or http://localhost:11434).
        timeout: Optional timeout in seconds (defaults to MACHSIGHT_LLM_TIMEOUT or 45).

    Returns:
        Dictionary adhering to the reason() contract:
            - action ("diagnose" | "request_more_data")
            - reasoning (str, 1 sentence)
            - diagnosis (str | null)
            - confidence (float | null, 0.0 to 1.0)
            - evidence_used (list[str])
            - recommended_action (str | null)
            - more_data (dict | null)
            - severity ("info" | "warning" | "critical")
            - ui_hints (dict with highlight_metrics and suggested_charts)
            - stage ("final")
    """
    model_name = model or os.environ.get("MACHSIGHT_LLM_MODEL", MACHSIGHT_LLM_MODEL)
    base_url = (ollama_url or os.environ.get("OLLAMA_URL", OLLAMA_URL)).rstrip("/")
    api_endpoint = f"{base_url}/api/chat"
    req_timeout = timeout or float(os.environ.get("MACHSIGHT_LLM_TIMEOUT", str(MACHSIGHT_LLM_TIMEOUT)))
    num_ctx = 2048

    history_str = _format_history(history)
    evidence_json = json.dumps(evidence, indent=2)

    user_prompt = f"""EVIDENCE:
{evidence_json}

INVESTIGATION HISTORY:
{history_str}

Evaluate the evidence above. If confident, provide a diagnosis. If ambiguous or confidence < 0.6, request more data.
Respond in valid JSON."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    request_body = {
        "model": model_name,
        "messages": messages,
        "stream": False,
        "keep_alive": "30m",
        "format": REASONING_JSON_SCHEMA,
        "options": {
            "temperature": 0,
            "repeat_penalty": 1.15,
            "num_ctx": num_ctx,
            "num_predict": 200,
        },
    }

    # Attempt LLM call with 1 retry on malformed output
    raw_content = ""
    for attempt in range(2):
        try:
            with httpx.Client(timeout=req_timeout) as client:
                resp = client.post(api_endpoint, json=request_body)

            if resp.status_code != 200:
                logger.warning(
                    f"Ollama returned HTTP status {resp.status_code}: {resp.text}"
                )
                return reason_fallback(
                    evidence, history, error_note=f"Ollama HTTP {resp.status_code}", stage="final"
                )

            data = resp.json()

            # Check and log context truncation
            prompt_eval_count = data.get("prompt_eval_count")
            if prompt_eval_count is not None:
                logger.info(f"Ollama prompt_eval_count: {prompt_eval_count} / {num_ctx}")
                if prompt_eval_count >= 0.9 * num_ctx:
                    logger.warning(
                        f"Ollama prompt_eval_count ({prompt_eval_count}) is within 10% of num_ctx ({num_ctx})! Context truncation risk."
                    )

            message = data.get("message", {})
            raw_content = message.get("content", "").strip()

            parsed = json.loads(raw_content)
            is_valid, validation_err = _validate_response_schema(parsed)

            if is_valid:
                return _normalize_output(parsed, evidence=evidence, stage="final")

            logger.warning(
                f"LLM response failed schema validation (attempt {attempt + 1}): {validation_err}"
            )

        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            logger.warning(f"Ollama unreachable at {api_endpoint}: {e}")
            return reason_fallback(evidence, history, error_note="Ollama connection failed", stage="final")

        except httpx.TimeoutException as e:
            logger.warning(f"Ollama timed out after {req_timeout}s: {e}")
            return reason_fallback(evidence, history, error_note=f"Ollama timed out ({req_timeout}s)", stage="final")

        except json.JSONDecodeError as e:
            logger.warning(
                f"Failed to parse LLM response as JSON (attempt {attempt + 1}): {e}. Raw content: {raw_content}"
            )

        except Exception as e:
            logger.error(f"Unexpected error communicating with Ollama: {e}")
            return reason_fallback(evidence, history, error_note=f"LLM error: {type(e).__name__}", stage="final")

        # If attempt 0 failed due to format, append stricter instruction and retry once
        if attempt == 0:
            request_body["messages"].append({"role": "assistant", "content": raw_content})
            request_body["messages"].append({
                "role": "user",
                "content": (
                    "CRITICAL ERROR: Your previous response was invalid. Return ONLY a valid JSON object "
                    "matching the requested schema. No markdown backticks, no explanations outside the JSON."
                ),
            })

    # If retry also failed, return deterministic fallback
    return reason_fallback(evidence, history, error_note="Invalid LLM output after retry", stage="final")
