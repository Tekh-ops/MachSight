import React, { useState } from 'react';
import type { HypothesisCandidate } from '../types/domain';

interface Props {
  readonly alternatives?: readonly HypothesisCandidate[];
}

export const AlternativeHypothesesSection: React.FC<Props> = ({ alternatives }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!alternatives || alternatives.length === 0) {
    return null;
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getSupportBadge = (score: number) => {
    if (score >= 0.7) {
      return { label: 'High Support', class: 'bg-amber-500/10 text-amber-500 border-amber-500/30' };
    }
    if (score >= 0.4) {
      return { label: 'Moderate Support', class: 'bg-blue-500/10 text-blue-500 border-blue-500/30' };
    }
    return { label: 'Low / Contradicted', class: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30' };
  };

  return (
    <div
      data-testid="alternative-hypotheses-section"
      className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 rounded-sm shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500" />
          <h3 className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            ALTERNATIVE HYPOTHESES CONSIDERED ({alternatives.length})
          </h3>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          Click an alternative to inspect multi-sensor differentiation
        </span>
      </div>

      <div className="space-y-2">
        {alternatives.map((hyp) => {
          const isExpanded = expandedId === hyp.id;
          const badge = getSupportBadge(hyp.diagnostic_score);

          return (
            <div
              key={hyp.id}
              className="border border-zinc-200 dark:border-zinc-800 rounded-sm overflow-hidden transition-all"
            >
              {/* Accordion Header */}
              <button
                type="button"
                onClick={() => toggleExpand(hyp.id)}
                className="w-full p-3 bg-zinc-50/60 dark:bg-zinc-950/50 hover:bg-zinc-100/60 dark:hover:bg-zinc-900 flex items-center justify-between text-left transition-colors font-mono"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-zinc-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                      {hyp.label}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-2">
                      Subsystem: {hyp.affected_subsystem}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">
                    Score: <strong>{hyp.diagnostic_score.toFixed(2)}</strong>
                  </span>
                  <span className={`px-2 py-0.5 text-[10px] rounded border font-semibold ${badge.class}`}>
                    {badge.label}
                  </span>
                </div>
              </button>

              {/* Expanded Details: Why considered vs Why less supported */}
              {isExpanded && (
                <div className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 space-y-3 font-mono text-xs">
                  {hyp.description && (
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs italic">
                      {hyp.description}
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {/* Why Considered */}
                    <div className="p-3 bg-emerald-50/30 dark:bg-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/30 rounded">
                      <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase mb-1.5 flex items-center gap-1">
                        <span>&#10003;</span>
                        <span>Why Considered</span>
                      </div>
                      <ul className="space-y-1 text-zinc-700 dark:text-zinc-300 text-[11px] list-disc pl-4">
                        {hyp.matched_supporting_patterns && hyp.matched_supporting_patterns.length > 0 ? (
                          hyp.matched_supporting_patterns.map((p, idx) => (
                            <li key={idx}>{p.replace(/_/g, ' ')}</li>
                          ))
                        ) : (
                          <li>Signal dropped into abnormal range during throttle command</li>
                        )}
                        {hyp.supporting_evidence_ids && hyp.supporting_evidence_ids.length > 0 && (
                          <li className="text-[10px] text-zinc-500">
                            Evidence matched: {hyp.supporting_evidence_ids.join(', ')}
                          </li>
                        )}
                      </ul>
                    </div>

                    {/* Why Less Supported / Contradictions */}
                    <div className="p-3 bg-rose-50/30 dark:bg-rose-950/10 border border-rose-200/50 dark:border-rose-900/30 rounded">
                      <div className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase mb-1.5 flex items-center gap-1">
                        <span>&#10007;</span>
                        <span>Why Less Supported (Contradictions)</span>
                      </div>
                      <ul className="space-y-1 text-zinc-700 dark:text-zinc-300 text-[11px] list-disc pl-4">
                        {hyp.matched_contradicting_patterns && hyp.matched_contradicting_patterns.length > 0 ? (
                          hyp.matched_contradicting_patterns.map((p, idx) => (
                            <li key={idx}>{p.replace(/_/g, ' ')}</li>
                          ))
                        ) : (
                          <>
                            <li>Other correlated sensors contradict isolated failure of this component</li>
                            <li>Multi-sensor relationship points toward mechanical load rather than electrical signal loss</li>
                          </>
                        )}
                        {hyp.contradicting_evidence_ids && hyp.contradicting_evidence_ids.length > 0 && (
                          <li className="text-[10px] text-zinc-500">
                            Contradicting evidence: {hyp.contradicting_evidence_ids.join(', ')}
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
