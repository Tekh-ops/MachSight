import React from 'react';
import type { ParsedDiagnosis, TelemetryPoint, MachineHealthStatus } from '../types/domain';
import { formatTimestamp } from '../utils/formatters';
import { WhatChangedSection } from './WhatChangedSection';
import { WhySection } from './WhySection';
import { AlternativeHypothesesSection } from './AlternativeHypothesesSection';
import { RecommendedActionsSection } from './RecommendedActionsSection';
import { UncertaintySection } from './UncertaintySection';
import { RecoveryCard } from './RecoveryCard';

interface Props {
  readonly diagnosis: ParsedDiagnosis | null;
  readonly healthStatus?: MachineHealthStatus;
  readonly latestTelemetry?: TelemetryPoint | null;
}

export const DiagnosticPanel: React.FC<Props> = ({
  diagnosis,
  healthStatus = 'HEALTHY',
  latestTelemetry = null,
}) => {
  // 1. RECOVERY STATE
  if (healthStatus === 'RECOVERED' || diagnosis?.is_recovery) {
    return <RecoveryCard diagnosis={diagnosis} latestTelemetry={latestTelemetry} />;
  }

  // 2. INVESTIGATING STATE
  if (healthStatus === 'INVESTIGATING' && (!diagnosis || diagnosis.severity === 'info')) {
    return (
      <div
        data-testid="diagnostic-panel-investigating"
        className="border border-amber-500/40 bg-amber-50/20 dark:bg-amber-950/20 p-6 rounded-sm shadow-sm space-y-3"
      >
        <div className="flex items-center gap-3">
          <span className="w-3.5 h-3.5 rounded-full bg-amber-400 animate-ping" />
          <h3 className="font-mono text-sm font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
            INVESTIGATION IN PROGRESS — COLLECTING EVIDENCE
          </h3>
        </div>
        <p className="font-mono text-xs text-zinc-700 dark:text-zinc-300 max-w-2xl leading-relaxed">
          An abnormal multivariate signal relationship was detected under active throttle. The autonomous reasoner is currently buffering high-resolution samples to evaluate trend persistence and evaluate candidate failure hypotheses.
        </p>
        <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-500 pt-2 border-t border-amber-200/40 dark:border-amber-900/30">
          <span>Target: {latestTelemetry?.machine_id || 'rc-sim-01'}</span>
          <span>&bull;</span>
          <span>Current throttle: PWM {latestTelemetry?.pwm_command ?? 0}</span>
          <span>&bull;</span>
          <span>Status: Evaluating multi-sensor correlation</span>
        </div>
      </div>
    );
  }

  // 3. NOMINAL / NO DIAGNOSIS STATE
  if (!diagnosis || (!diagnosis.primary_hypothesis && !diagnosis.diagnosis && healthStatus === 'HEALTHY')) {
    return (
      <div
        data-testid="diagnostic-panel"
        className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-6 text-center rounded-sm"
      >
        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase">
          No Diagnostic Assessment Available
        </h3>
        <p className="font-mono text-xs text-zinc-500 mt-1 max-w-lg mx-auto">
          Nominal Operating Status — All operating telemetry conforms to conditioned baseline reference models. The autonomous AI diagnostic reasoner runs continuously when multivariate anomalies or causal signal divergences are detected.
        </p>
      </div>
    );
  }

  // 4. ACTIVE DIAGNOSTIC CONSOLE
  const primary = diagnosis.primary_hypothesis;
  const primaryTitle = primary?.label || diagnosis.diagnosis || 'Mechanical Obstruction Detected';
  const diagnosticScore = primary?.diagnostic_score ?? diagnosis.confidence ?? 0;
  const severity = diagnosis.severity || 'warning';

  const getSeverityBadge = () => {
    switch (severity) {
      case 'critical':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
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
      className="space-y-4"
    >
      {/* Primary Hypothesis Card */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm rounded-sm overflow-hidden">
        {/* Card Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 font-mono">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">
              PRIMARY HYPOTHESIS
            </span>
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${getSeverityBadge()}`}>
              SEVERITY: {severity}
            </span>
            {diagnosis.stage && (
              <span className="px-2 py-0.5 text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded uppercase">
                {diagnosis.stage}
              </span>
            )}
          </div>

          <div className="text-xs text-zinc-500 flex items-center gap-3">
            {diagnosis.timestamp && (
              <span>Identified: {formatTimestamp(diagnosis.timestamp)}</span>
            )}
            <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-800 dark:text-zinc-200">
              Diagnostic Score: <strong>{diagnosticScore.toFixed(2)}</strong>
              {diagnosis.confidence !== null && diagnosis.confidence !== undefined && (
                <span className="ml-1 text-zinc-500">({Math.round(diagnosis.confidence * 100)}%)</span>
              )}
            </span>
          </div>
        </div>

        {/* Hypothesis Summary & Subsystem */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1">
            <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">
              AI Diagnostic Conclusion
            </div>
            <h3 className="text-xl font-mono font-extrabold text-zinc-900 dark:text-zinc-100">
              {primaryTitle}
            </h3>
            <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 pt-1 leading-relaxed">
              {primary?.description ||
                'Elevated motor current without corresponding wheel RPM under sustained throttle command indicates excessive mechanical resistance in the drivetrain.'}
            </p>
          </div>

          <div className="p-4 bg-zinc-50/60 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 rounded font-mono">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Affected Subsystem
            </div>
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase">
              {primary?.affected_subsystem ||
                (typeof diagnosis.suspected_component === 'string'
                  ? diagnosis.suspected_component
                  : 'Drivetrain / Motor')}
            </div>
            <div className="text-[11px] text-zinc-500 mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              Reasoner: {diagnosis.fallback_active ? 'Rule Fallback' : 'Qwen 2.5 3B'}
            </div>
          </div>
        </div>
      </div>

      {/* What Changed Section */}
      <WhatChangedSection items={diagnosis.what_changed} />

      {/* The Why Section */}
      <WhySection diagnosis={diagnosis} />

      {/* Alternative Hypotheses Section */}
      <AlternativeHypothesesSection alternatives={diagnosis.alternative_hypotheses} />

      {/* Recommended Actions Section */}
      <RecommendedActionsSection
        checks={diagnosis.recommended_checks}
        action={diagnosis.recommended_action}
        severity={severity}
      />

      {/* Uncertainty Section */}
      <UncertaintySection uncertainty={diagnosis.uncertainty} />
    </div>
  );
};
