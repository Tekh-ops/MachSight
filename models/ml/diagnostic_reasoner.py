"""Intelligent Diagnostic Reasoner for MachSight Phase 2.

This module implements the evidence-based Qwen 3B reasoning pipeline:

    DiagnosticEvidencePacket
          ↓
    Hypothesis scoring (deterministic)
          ↓
    Compact LLM payload construction
          ↓
    Qwen 3B reasoning (structured JSON output)
          ↓
    Schema validation + normalization
          ↓
    DiagnosticResult (with evidence, alternatives, uncertainty, checks)

Design principles:
  - Qwen synthesizes and explains — it does NOT score hypotheses.
  - Every reasoning statement must be traceable to evidence items (E001…).
  - The LLM cannot invent observations, only interpret provided evidence.
  - Graceful fallback: MachSight never crashes when Qwen is unavailable.
  - Recovery reasoning is a first-class event, not just absence of fault.

Compatible with existing main.py architecture:
  - Exports `reason_v2()` for use in trigger_investigation().
  - Exports `reason_fallback_v2()` for graceful degradation.
  - The existing `reason()` / `reason_fallback()` remain untouched.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx

from .temporal_evidence import (
    DiagnosticEvidencePacket,
    MachineOperatingState,
    Persistence,
)
from .hypothesis_scorer import ScoredHypothesis, score_hypotheses

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MACHSIGHT_LLM_MODEL = os.environ.get("MACHSIGHT_LLM_MODEL", "qwen2.5:3b-instruct")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MACHSIGHT_LLM_TIMEOUT = float(os.environ.get("MACHSIGHT_LLM_TIMEOUT", "60"))

# ---------------------------------------------------------------------------
# Output JSON schema for Ollama structured outputs
# ---------------------------------------------------------------------------

DIAGNOSTIC_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "machine_state": {"type": "string"},
        "primary_hypothesis_id": {"type": "string"},
        "reasoning": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "statement": {"type": "string"},
                    "evidence_ids": {
                        "type": "array",
                        "items": {"type": "string"}
                    }
                },
                "required": ["statement", "evidence_ids"]
            }
        },
        "uncertainty": {
            "type": "array",
            "items": {"type": "string"}
        },
        "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]},
        "recommended_action": {
            "type": "array",
            "items": {"type": "string"}
        },
    },
    "required": [
        "machine_state",
        "primary_hypothesis_id",
        "reasoning",
        "uncertainty",
        "severity",
        "recommended_action",
    ]
}

# ---------------------------------------------------------------------------
# System prompt builder
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEMPLATE = """You are MachSight Diagnostic Reasoner — an expert AI assistant for industrial machine diagnostics.

Your role is to reason over pre-computed engineering evidence and explain which fault hypothesis best explains the observed telemetry, and why.

CRITICAL RULES:
1. You are provided with structured evidence items (E001, E002, …). Do NOT invent evidence not in the list.
2. You are provided with pre-scored hypotheses. Your job is to explain the reasoning, NOT re-score.
3. Use language: "consistent with", "suggests", "likely", "possible", "cannot rule out", "requires inspection".
4. Distinguish OBSERVED (from evidence) from INFERRED (reasoned) from RECOMMENDED (action).
5. In your reasoning array, cite specific evidence IDs (e.g., "E001", "E003") for each reasoning statement.
6. In uncertainty, state what the telemetry CANNOT determine — do not make up certainty that doesn't exist.
7. For recovery events, acknowledge the improvement and explain what returned to normal.
8. primary_hypothesis_id MUST be one of the candidate hypothesis IDs provided.
9. Keep each reasoning statement concise (max 2 sentences). Total reasoning array: 3-5 statements.
10. Respond ONLY with valid JSON matching the schema. No markdown, no explanation outside JSON.

LANGUAGE EXAMPLES (use these styles):
- "The combination of elevated current and collapsed RPM is consistent with increased drivetrain resistance."
- "Vehicle velocity also decreased, making an isolated RPM sensor failure less likely."
- "Telemetry cannot determine whether the obstruction is a blocked wheel or internal gear binding without physical inspection."
"""


def _build_user_prompt(
    packet: DiagnosticEvidencePacket,
    scored_hypotheses: List[ScoredHypothesis],
    is_recovery_event: bool = False,
) -> str:
    """Build a compact, token-efficient prompt for Qwen."""

    evidence_lines = []
    for e in packet.evidence_items:
        supports = ", ".join(e.supports) if e.supports else "none"
        contradicts = ", ".join(e.contradicts) if e.contradicts else "none"
        evidence_lines.append(
            f"  [{e.id}] {e.description} "
            f"(confidence={e.confidence:.2f}, supports=[{supports}], contradicts=[{contradicts}])"
        )

    hyp_lines = []
    for h in scored_hypotheses[:4]:
        hyp_lines.append(
            f"  - {h.id}: \"{h.label}\" "
            f"(diagnostic_score={h.diagnostic_score:.2f}, "
            f"supporting_patterns={len(h.matched_supporting_patterns)}, "
            f"contradicting_patterns={len(h.matched_contradicting_patterns)})"
        )

    relationships = ", ".join(packet.temporal_relationships) if packet.temporal_relationships else "none"
    context = "RECOVERY EVENT — signals are returning toward baseline." if is_recovery_event else "FAULT CONDITION"

    prompt = f"""DIAGNOSTIC CONTEXT: {context}
Machine: {packet.machine_id}
Operating state: {packet.operating_state.value}
Persistence: {packet.persistence.value}
Time window: {packet.time_window_seconds:.1f}s

CURRENT READINGS vs BASELINE:
  Current: {packet.current.get('current_a', 'N/A')}A (baseline: {packet.current.get('baseline_a', 'N/A')}A, change: {packet.current.get('increase_pct', 'N/A')}%)
  RPM: {packet.rpm.get('current_rpm', 'N/A')} (baseline: {packet.rpm.get('baseline_rpm', 'N/A')}, change: {packet.rpm.get('change_pct', 'N/A')}%)
  PWM: {packet.motor_command.get('pwm', 'N/A')} (sustained: {packet.motor_command.get('sustained', 'N/A')})
  Ultrasonic: {packet.ultrasonic.get('distance_cm', 'N/A') if packet.ultrasonic else 'N/A'}cm

TEMPORAL RELATIONSHIPS:
  {relationships}

EVIDENCE ITEMS:
{chr(10).join(evidence_lines) if evidence_lines else '  (no structured evidence items)'}

CANDIDATE HYPOTHESES (pre-scored by engineering rules, DO NOT re-score):
{chr(10).join(hyp_lines) if hyp_lines else '  (no candidates)'}

PRIMARY CANDIDATE (highest score): {scored_hypotheses[0].id if scored_hypotheses else 'UNKNOWN'}

TASK:
1. Explain WHY the primary candidate best fits the evidence. Cite evidence IDs.
2. Explain WHY alternatives score lower (if significant).
3. State what remains uncertain from telemetry alone.
4. List corrective recommended_actions ordered by urgency.
5. Set severity to: LOW / MEDIUM / HIGH / CRITICAL

Return valid JSON only."""

    return prompt


# ---------------------------------------------------------------------------
# Output schema validation
# ---------------------------------------------------------------------------

def _validate_diagnostic_response(res: Any) -> tuple[bool, str]:
    if not isinstance(res, dict):
        return False, "Not a dict"
    required = ["machine_state", "primary_hypothesis_id", "reasoning",
                 "uncertainty", "severity", "recommended_action"]
    for k in required:
        if k not in res:
            return False, f"Missing key: {k}"
    if not isinstance(res["reasoning"], list) or len(res["reasoning"]) == 0:
        return False, "reasoning must be a non-empty list"
    if res["severity"] not in ("LOW", "MEDIUM", "HIGH", "CRITICAL"):
        return False, f"Invalid severity: {res['severity']}"
    return True, ""


# ---------------------------------------------------------------------------
# Structured diagnostic result
# ---------------------------------------------------------------------------

def _build_structured_result(
    packet: DiagnosticEvidencePacket,
    scored_hypotheses: List[ScoredHypothesis],
    llm_output: Optional[Dict[str, Any]],
    is_recovery: bool = False,
    fallback_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble the final structured DiagnosticResult.

    Merges:
      - Deterministic scores and evidence (source: engineering rules)
      - LLM reasoning, uncertainty, and recommendations (source: Qwen)
      - Fallback reasoning when LLM is unavailable

    The output contract is an extension of the existing investigation payload,
    with additional structured fields for the Phase 2 frontend.
    """
    now = time.time()
    diagnosis_id = str(uuid.uuid4())

    primary = scored_hypotheses[0] if scored_hypotheses else None
    alternatives = scored_hypotheses[1:] if len(scored_hypotheses) > 1 else []

    evidence_dicts = [e.to_dict() for e in packet.evidence_items]

    # ------------------------------------------------------------------
    # Derive severity from top hypothesis if LLM didn't provide one
    # ------------------------------------------------------------------
    severity_map = {"LOW": "info", "MEDIUM": "warning", "HIGH": "critical", "CRITICAL": "critical"}

    if is_recovery:
        primary_label = "Recovery observed — signals returning to baseline"
        primary_id = "RECOVERY"
        severity_v2 = "info"
        llm_reasoning = [
            {
                "statement": "Motor current returned toward healthy baseline.",
                "evidence_ids": [e.id for e in packet.evidence_items if "current" in e.source],
            },
            {
                "statement": "Wheel RPM returned toward healthy baseline.",
                "evidence_ids": [e.id for e in packet.evidence_items if "rpm" in e.source],
            },
        ]
        llm_uncertainty = ["Continue monitoring to confirm the fault condition does not recur."]
        llm_actions = ["Monitor telemetry for the next 30 seconds to confirm stability."]
        llm_machine_state = "RECOVERING"

    elif llm_output:
        primary_id = llm_output.get("primary_hypothesis_id", primary.id if primary else "UNKNOWN")
        llm_reasoning = llm_output.get("reasoning", [])
        llm_uncertainty = llm_output.get("uncertainty", [])
        llm_actions = llm_output.get("recommended_action", [])
        llm_machine_state = llm_output.get("machine_state", packet.operating_state.value)
        severity_v2 = severity_map.get(llm_output.get("severity", "MEDIUM"), "warning")
        primary_label = primary.label if primary else primary_id

    else:
        # Fallback: deterministic from scored hypothesis
        primary_id = primary.id if primary else "UNKNOWN"
        primary_label = primary.label if primary else "Unknown fault"
        llm_reasoning = [
            {
                "statement": (
                    f"Rule-based classification identified {primary_id} "
                    f"with diagnostic score {primary.diagnostic_score:.2f}."
                    if primary else "No candidates scored above threshold."
                ),
                "evidence_ids": [e.id for e in packet.evidence_items[:2]],
            }
        ]
        llm_uncertainty = [
            "LLM reasoning unavailable. Evidence-based hypothesis scoring was used.",
            "Telemetry cannot identify the exact physical component without inspection.",
        ]
        llm_actions = (
            [c["action"] for c in primary.recommended_checks[:3]] if primary else
            ["Manual inspection recommended."]
        )
        severity_raw = primary.severity if primary else "MEDIUM"
        severity_v2 = severity_map.get(severity_raw, "warning")
        llm_machine_state = packet.operating_state.value

    # Build recommended checks from primary hypothesis (ordered, deterministic)
    recommended_checks = primary.recommended_checks if primary else []

    # ------------------------------------------------------------------
    # Final result payload — backward-compatible + Phase 2 extensions
    # ------------------------------------------------------------------
    result = {
        # --- Phase 2 structured output ---
        "diagnosis_id": diagnosis_id,
        "timestamp": now,
        "machine_id": packet.machine_id,
        "machine_state": llm_machine_state,
        "operating_state": packet.operating_state.value,
        "is_recovery": is_recovery,

        "primary_hypothesis": {
            "id": primary_id,
            "label": primary_label,
            "description": primary.description if primary else "",
            "diagnostic_score": round(primary.diagnostic_score, 3) if primary else 0.0,
            "affected_subsystem": primary.affected_subsystem if primary else "unknown",
            "supporting_evidence_ids": primary.supporting_evidence_ids if primary else [],
            "contradicting_evidence_ids": primary.contradicting_evidence_ids if primary else [],
            "matched_supporting_patterns": primary.matched_supporting_patterns if primary else [],
            "matched_contradicting_patterns": primary.matched_contradicting_patterns if primary else [],
        },

        "alternative_hypotheses": [
            {
                "id": h.id,
                "label": h.label,
                "description": h.description,
                "diagnostic_score": round(h.diagnostic_score, 3),
                "affected_subsystem": h.affected_subsystem,
                "supporting_evidence_ids": h.supporting_evidence_ids,
                "contradicting_evidence_ids": h.contradicting_evidence_ids,
                "matched_supporting_patterns": h.matched_supporting_patterns,
                "matched_contradicting_patterns": h.matched_contradicting_patterns,
            }
            for h in alternatives
        ],

        "signals_summary": {
            "current": packet.current,
            "rpm": packet.rpm,
            "velocity": packet.velocity,
            "motor_command": packet.motor_command,
            "trends": packet.trends,
            "persistence": packet.persistence.value,
            "temporal_relationships": packet.temporal_relationships,
        },

        "what_changed": [
            {
                "metric": "Motor Command",
                "baseline": "Forward Cruise",
                "current": f"PWM {packet.motor_command.get('pwm', 0)} ({'Sustained' if packet.motor_command.get('sustained') else 'Transient'})",
                "change": "sustained high" if packet.motor_command.get("sustained") else "normal",
                "status": "nominal" if not packet.motor_command.get("sustained") else "concerning",
            },
            {
                "metric": "Motor Current",
                "baseline": f"{packet.current.get('baseline_a', 1.6):.2f} A",
                "current": f"{packet.current.get('current_a', 0.0):.2f} A",
                "change": f"{'+' if (packet.current.get('increase_pct') or 0) > 0 else ''}{packet.current.get('increase_pct', 0):.0f}%",
                "status": "elevated" if (packet.current.get("increase_pct") or 0) > 30 else "nominal",
            },
            {
                "metric": "Wheel RPM",
                "baseline": f"{packet.rpm.get('baseline_rpm', 225):.0f} RPM",
                "current": f"{packet.rpm.get('current_rpm', 0):.0f} RPM",
                "change": f"{packet.rpm.get('change_pct', 0):.0f}%",
                "status": "collapsed" if (packet.rpm.get("change_pct") or 0) < -50 else "nominal",
            },
            *(
                [{
                    "metric": "Vehicle Motion",
                    "baseline": f"{packet.velocity.get('baseline_mps', 0.8):.2f} m/s",
                    "current": f"{packet.velocity.get('current_mps', 0.0):.2f} m/s",
                    "change": f"{packet.velocity.get('change_pct', 0):.0f}%",
                    "status": "stalled" if (packet.velocity.get("change_pct") or 0) < -50 else "nominal",
                }]
                if packet.velocity else []
            ),
            {
                "metric": "Condition Persistence",
                "baseline": "Transient noise",
                "current": packet.persistence.value.capitalize(),
                "change": f"Window {packet.time_window_seconds:.1f}s",
                "status": "concerning" if packet.persistence == Persistence.PERSISTENT else "nominal",
            },
        ],

        "evidence": evidence_dicts,

        "reasoning": llm_reasoning,

        "uncertainty": llm_uncertainty,

        "recommended_checks": recommended_checks,

        "recommended_action": llm_actions,

        "severity": severity_v2,

        "fallback_active": llm_output is None,
        "fallback_reason": fallback_reason,

        # --- Backward-compatible legacy fields (for existing frontend/tests) ---
        "action": "diagnose",
        "diagnosis": primary_label,
        "confidence": round(primary.diagnostic_score, 2) if primary else 0.0,
        "evidence_used": [e.id for e in packet.evidence_items],
        "recommended_action_legacy": llm_actions[0] if llm_actions else None,
        "more_data": None,
        "stage": "final",
        "ui_hints": {
            "highlight_metrics": ["current_a", "rpm", "pwm_command"],
            "suggested_charts": ["current_timeline", "rpm_timeline"],
        },
    }

    return result


# ---------------------------------------------------------------------------
# Recovery result
# ---------------------------------------------------------------------------

def build_recovery_result(
    packet: DiagnosticEvidencePacket,
    previous_hypothesis_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a structured recovery diagnosis when signals return to baseline."""
    scored = score_hypotheses(packet, max_candidates=1)
    result = _build_structured_result(
        packet=packet,
        scored_hypotheses=scored,
        llm_output=None,
        is_recovery=True,
    )
    result["previous_hypothesis_id"] = previous_hypothesis_id
    return result


# ---------------------------------------------------------------------------
# Deterministic fallback
# ---------------------------------------------------------------------------

def reason_fallback_v2(
    packet: DiagnosticEvidencePacket,
    fallback_reason: str = "LLM unavailable",
) -> Dict[str, Any]:
    """Deterministic fallback diagnosis when Qwen is unavailable.

    Uses hypothesis scorer + evidence items — no LLM required.
    MachSight never crashes or produces empty output.
    """
    scored = score_hypotheses(packet)
    return _build_structured_result(
        packet=packet,
        scored_hypotheses=scored,
        llm_output=None,
        fallback_reason=fallback_reason,
    )


# ---------------------------------------------------------------------------
# Main LLM reasoning function
# ---------------------------------------------------------------------------

def reason_v2(
    packet: DiagnosticEvidencePacket,
    is_recovery: bool = False,
    model: Optional[str] = None,
    ollama_url: Optional[str] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Intelligent evidence-based diagnostic reasoning using Qwen 3B.

    Pipeline:
      1. Score all catalog hypotheses deterministically.
      2. Build compact LLM payload (evidence packet + top candidates).
      3. Call Qwen via Ollama for structured JSON reasoning.
      4. Validate schema, normalize output.
      5. Merge LLM reasoning with deterministic scores.
      6. Return structured DiagnosticResult.

    Graceful degradation:
      - If Qwen is unreachable, slow, or returns invalid JSON:
        falls back to reason_fallback_v2() (deterministic, no LLM).
      - MachSight NEVER crashes or returns empty output.

    Args:
        packet: DiagnosticEvidencePacket from temporal_evidence module.
        is_recovery: True if this is a recovery event diagnosis.
        model: Optional Ollama model override.
        ollama_url: Optional Ollama URL override.
        timeout: Optional timeout in seconds.

    Returns:
        Structured DiagnosticResult dict (backward-compatible + Phase 2 fields).
    """
    # Step 1: Score hypotheses deterministically
    scored = score_hypotheses(packet, max_candidates=4)

    if is_recovery:
        result = _build_structured_result(
            packet=packet,
            scored_hypotheses=scored,
            llm_output=None,
            is_recovery=True,
        )
        return result

    # Step 2: Decide if LLM invocation is worthwhile
    model_name = model or MACHSIGHT_LLM_MODEL
    base_url = (ollama_url or OLLAMA_URL).rstrip("/")
    req_timeout = timeout or MACHSIGHT_LLM_TIMEOUT
    api_endpoint = f"{base_url}/api/chat"

    # Step 3: Build prompt
    user_prompt = _build_user_prompt(packet, scored, is_recovery_event=is_recovery)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT_TEMPLATE},
        {"role": "user", "content": user_prompt},
    ]

    request_body = {
        "model": model_name,
        "messages": messages,
        "stream": False,
        "keep_alive": "30m",
        "format": DIAGNOSTIC_JSON_SCHEMA,
        "options": {
            "temperature": 0,
            "repeat_penalty": 1.1,
            "num_ctx": 3072,
            "num_predict": 512,
        },
    }

    # Step 4: Call Qwen (with 1 retry on malformed JSON)
    raw_content = ""
    for attempt in range(2):
        try:
            with httpx.Client(timeout=httpx.Timeout(req_timeout, connect=3.0)) as client:
                resp = client.post(api_endpoint, json=request_body)

            if resp.status_code != 200:
                logger.warning(f"Ollama HTTP {resp.status_code}: {resp.text[:200]}")
                return reason_fallback_v2(packet, fallback_reason=f"Ollama HTTP {resp.status_code}")

            data = resp.json()
            message = data.get("message", {})
            raw_content = message.get("content", "").strip()

            parsed = json.loads(raw_content)
            is_valid, err = _validate_diagnostic_response(parsed)

            if is_valid:
                logger.info(
                    f"[reason_v2] Qwen reasoning success for machine={packet.machine_id} "
                    f"primary={parsed.get('primary_hypothesis_id')} "
                    f"severity={parsed.get('severity')}"
                )
                return _build_structured_result(
                    packet=packet,
                    scored_hypotheses=scored,
                    llm_output=parsed,
                )

            logger.warning(f"[reason_v2] Schema validation failed (attempt {attempt+1}): {err}")

        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            logger.warning(f"[reason_v2] Ollama unreachable: {e}")
            return reason_fallback_v2(packet, fallback_reason="Ollama connection failed")

        except httpx.TimeoutException as e:
            logger.warning(f"[reason_v2] Ollama timed out after {req_timeout}s: {e}")
            return reason_fallback_v2(packet, fallback_reason=f"Ollama timeout ({req_timeout}s)")

        except json.JSONDecodeError as e:
            logger.warning(f"[reason_v2] JSON parse error (attempt {attempt+1}): {e}")

        except Exception as e:
            logger.error(f"[reason_v2] Unexpected error: {e}")
            return reason_fallback_v2(packet, fallback_reason=f"LLM error: {type(e).__name__}")

        # Retry with stricter prompt
        if attempt == 0:
            request_body["messages"].append({"role": "assistant", "content": raw_content})
            request_body["messages"].append({
                "role": "user",
                "content": (
                    "ERROR: Your previous response was invalid JSON or did not match the schema. "
                    "Return ONLY a valid JSON object with exactly these keys: "
                    "machine_state, primary_hypothesis_id, reasoning (array), "
                    "uncertainty (array), severity, recommended_action (array). "
                    "No text outside the JSON object."
                ),
            })

    # Both attempts failed
    return reason_fallback_v2(packet, fallback_reason="Invalid LLM output after retry")
