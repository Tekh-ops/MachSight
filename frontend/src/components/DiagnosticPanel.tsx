import React from 'react';
import type { ParsedDiagnosis } from '../types/domain';
import { formatPercent, formatTimestamp } from '../utils/formatters';

interface Props {
  readonly diagnosis: ParsedDiagnosis | null;
}

export const DiagnosticPanel: React.FC<Props> = ({ diagnosis }) => {
  if (!diagnosis) {
    return (
      <div
        data-testid="diagnostic-panel"
        className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200">
          No Diagnostic Assessment Available
        </h3>
        <p className="font-sans text-xs text-zinc-500 mt-1 max-w-md mx-auto">
          The autonomous AI diagnostic reasoner runs when multivariate anomalies are detected. Currently all operating telemetry is within nominal tolerances.
        </p>
      </div>
    );
  }

  const getSeverityBadge = () => {
    switch (diagnosis.severity) {
      case 'critical':
        return 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse';
      case 'warning':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'info':
      default:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    }
  };

  return (
    <div
      data-testid="diagnostic-panel"
      className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
    >
      {/* Panel Header */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
          <h2 className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            CURRENT DIAGNOSTIC ASSESSMENT
          </h2>
          <span className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded border ${getSeverityBadge()}`}>
            {diagnosis.severity}
          </span>
          {diagnosis.stage && (
            <span className="px-2 py-0.5 text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded uppercase">
              {diagnosis.stage} STAGE
            </span>
          )}
        </div>

        <div className="font-mono text-xs text-zinc-500 flex items-center gap-3">
          {diagnosis.timestamp && (
            <span>Timestamp: {formatTimestamp(diagnosis.timestamp)}</span>
          )}
          {diagnosis.confidence !== null && (
            <span>
              Confidence: <strong className="text-zinc-900 dark:text-zinc-100">{formatPercent(diagnosis.confidence)}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Core Diagnosis Statement & Suspected Component */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/40 dark:bg-zinc-950/30">
            <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Diagnostic Conclusion
            </div>
            <div className="text-base font-mono font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
              {diagnosis.diagnosis || 'Diagnostic assessment in progress'}
            </div>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/40 dark:bg-zinc-950/30">
            <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Suspected Component
            </div>
            <div className="text-lg font-mono font-extrabold text-blue-600 dark:text-blue-400 uppercase">
              {(() => {
                const comp = diagnosis.suspected_component;
                if (!comp) return 'Component not identified';
                if (typeof comp === 'object') {
                  return comp.display_name || comp.component_id || 'Component not identified';
                }
                return comp;
              })()}
            </div>
            <div className="text-[10px] font-mono text-zinc-500 mt-1">
              {diagnosis.suspected_component ? 'Isolated by multi-signal correlation' : 'No hardware isolate'}
            </div>
          </div>
        </div>

        {/* Explainability Pipeline: OBSERVATIONS -> EVIDENCE -> HYPOTHESES */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase mb-3 flex items-center gap-2">
            <span>Explainability & Diagnostic Evidence Trail</span>
            <span className="text-[10px] font-normal text-zinc-500 font-mono">
              [OBSERVATIONS &rarr; EVIDENCE &rarr; REASONING]
            </span>
          </div>

          <div className="space-y-3">
            {/* 1. Evidence Points from Backend */}
            <div>
              <div className="text-[11px] font-mono font-semibold text-zinc-500 mb-1">
                EVIDENCE USED ({diagnosis.evidence_used?.length || 0} POINTS):
              </div>
              {diagnosis.evidence_used && diagnosis.evidence_used.length > 0 ? (
                <ul className="space-y-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300 pl-4 list-disc">
                  {diagnosis.evidence_used.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs font-mono text-zinc-400 italic">No structured evidence reported.</div>
              )}
            </div>

            {/* 2. Structured Reasoning / Correlation */}
            {diagnosis.reasoning && (
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="text-[11px] font-mono font-semibold text-zinc-500 mb-1">
                  STRUCTURED DIAGNOSTIC REASONING:
                </div>
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 leading-relaxed whitespace-pre-wrap">
                  {diagnosis.reasoning}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recommended Operator Action */}
        {diagnosis.recommended_action && (
          <div className="border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div className="text-[11px] font-mono font-bold text-blue-700 dark:text-blue-300 uppercase">
                Recommended Operator Action
              </div>
              <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200 mt-0.5">
                {diagnosis.recommended_action}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
