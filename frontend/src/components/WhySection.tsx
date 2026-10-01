import React from 'react';
import type { StructuredEvidenceItem, StructuredReasoningStatement, ParsedDiagnosis } from '../types/domain';

interface Props {
  readonly diagnosis: ParsedDiagnosis;
}

export const WhySection: React.FC<Props> = ({ diagnosis }) => {
  const evidenceItems: readonly StructuredEvidenceItem[] = diagnosis.evidence || [];
  const rawReasoning = diagnosis.reasoning;
  const reasoningStatements: readonly StructuredReasoningStatement[] = Array.isArray(rawReasoning)
    ? rawReasoning
    : typeof rawReasoning === 'string'
    ? [{ statement: rawReasoning, evidence_ids: diagnosis.evidence_used || [] }]
    : [];

  const primaryHypothesis = diagnosis.primary_hypothesis?.label || diagnosis.diagnosis || 'Mechanical Obstruction';

  // Extract observations directly from structured evidence
  const observedItems = evidenceItems.length > 0
    ? evidenceItems
    : (diagnosis.evidence_used || []).map((desc, i) => ({
        id: `E00${i + 1}`,
        type: 'observed_behavior',
        description: desc,
        source: 'telemetry',
        value: null,
        baseline: null,
        change_pct: null,
        confidence: 0.9,
        supports: [],
        contradicts: [],
      }));

  // Extract recommendations
  const actionText = Array.isArray(diagnosis.recommended_action)
    ? diagnosis.recommended_action[0]
    : diagnosis.recommended_action;

  return (
    <div
      data-testid="why-section"
      className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 rounded-sm shadow-sm space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
          <h3 className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            WHY DOES MACHSIGHT THINK THIS?
          </h3>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center gap-2">
          <span>AI REASONER:</span>
          {diagnosis.fallback_active ? (
            <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded font-semibold">
              Deterministic Rules (Fallback)
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded font-semibold">
              Qwen 2.5 3B (Active)
            </span>
          )}
        </div>
      </div>

      {/* 4-Tier Epistemic Hierarchy: OBSERVED -> INFERRED -> HYPOTHESIS -> RECOMMENDATION */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 1. OBSERVED */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40 rounded-sm">
          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span>1. OBSERVED (DATA)</span>
          </div>
          <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200 space-y-1.5">
            {observedItems.slice(0, 3).map((e, idx) => (
              <div key={idx} className="leading-snug">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold mr-1">&bull;</span>
                {e.description}
                {e.id && (
                  <span className="ml-1 text-[10px] text-zinc-400 font-normal">[{e.id}]</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 2. INFERRED */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40 rounded-sm">
          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            <span>2. INFERRED (PHYSICS)</span>
          </div>
          <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200 leading-snug">
            {reasoningStatements.length > 0 && reasoningStatements[0]?.statement
              ? reasoningStatements[0].statement
              : 'Motor commanded to drive at high throttle, but elevated current is not producing wheel rotation.'}
          </div>
        </div>

        {/* 3. HYPOTHESIS */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40 rounded-sm">
          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>3. HYPOTHESIS</span>
          </div>
          <div className="text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100">
            {primaryHypothesis}
          </div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">
            Score: <strong className="text-zinc-800 dark:text-zinc-200">{(diagnosis.primary_hypothesis?.diagnostic_score ?? diagnosis.confidence ?? 0).toFixed(2)}</strong>
          </div>
        </div>

        {/* 4. RECOMMENDATION */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40 rounded-sm">
          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>4. ACTION</span>
          </div>
          <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200 leading-snug">
            {actionText || 'Inspect wheels and drivetrain for mechanical binding or obstruction.'}
          </div>
        </div>
      </div>

      {/* Structured Evidence Checklist */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
        <div className="text-[11px] font-mono font-bold text-zinc-500 uppercase mb-2.5">
          SUPPORTING EVIDENCE & CORRELATIONS
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
          {observedItems.map((item, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 p-2 rounded bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800/80"
            >
              <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0 mt-0.5">&#10003;</span>
              <div className="flex-1">
                <span className="text-zinc-800 dark:text-zinc-200">{item.description}</span>
                {item.id && (
                  <span className="ml-2 px-1.5 py-0.2 bg-zinc-200/60 dark:bg-zinc-800 text-[10px] text-zinc-500 rounded">
                    {item.id}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interpretation Narrative */}
      {reasoningStatements.length > 0 && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
          <div className="text-[11px] font-mono font-bold text-zinc-500 uppercase mb-1.5">
            CAUSAL INTERPRETATION
          </div>
          <div className="p-3 bg-zinc-50/70 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800 font-mono text-xs text-zinc-800 dark:text-zinc-200 space-y-1.5 leading-relaxed">
            {reasoningStatements.map((stmt, idx) => (
              <p key={idx}>
                {stmt.statement}
                {stmt.evidence_ids && stmt.evidence_ids.length > 0 && (
                  <span className="text-[10px] text-zinc-500 ml-1.5">
                    (Ev: {stmt.evidence_ids.join(', ')})
                  </span>
                )}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
