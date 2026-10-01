import React from 'react';
import type { RecommendedCheckStep } from '../types/domain';

interface Props {
  readonly checks?: readonly RecommendedCheckStep[];
  readonly action?: string | readonly string[] | null;
  readonly severity?: 'critical' | 'warning' | 'info';
}

export const RecommendedActionsSection: React.FC<Props> = ({ checks, action, severity }) => {
  const isHighSeverity = severity === 'critical' || severity === 'warning';

  const defaultSteps: RecommendedCheckStep[] = [
    { step: 1, action: 'Inspect driven wheels for external obstruction, gravel, or binding debris.', target_component: 'wheels_axle', safety_priority: 'high' },
    { step: 2, action: 'Rotate wheels manually by hand with power disconnected to check for drivetrain mechanical binding.', target_component: 'drivetrain', safety_priority: 'high' },
    { step: 3, action: 'Inspect motor-to-gearbox pinions and drive gear mesh alignment.', target_component: 'gearbox', safety_priority: 'medium' },
    { step: 4, action: 'Perform a low-throttle verification test (PWM 50) after clearing obstruction.', target_component: 'system', safety_priority: 'low' },
  ];

  const steps = checks && checks.length > 0 ? checks : defaultSteps;

  return (
    <div
      data-testid="recommended-actions-section"
      className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 rounded-sm shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <h3 className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            RECOMMENDED TECHNICIAN NEXT STEPS (ORDERED BY PRIORITY)
          </h3>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          Informational maintenance advisory
        </span>
      </div>

      {/* Safety Alert for High Severity */}
      {isHighSeverity && (
        <div className="p-3 bg-rose-50/50 dark:bg-rose-950/20 border-l-4 border-rose-500 text-xs font-mono">
          <div className="font-bold text-rose-700 dark:text-rose-400 uppercase flex items-center gap-1.5">
            <span>⚠ SAFETY ADVISORY</span>
          </div>
          <div className="text-zinc-700 dark:text-zinc-300 mt-1">
            Cut or avoid sustained high-current throttle command until the physical obstruction has been cleared. Sustained stall current risks thermal degradation of motor windings and driver FETs.
          </div>
        </div>
      )}

      {/* Primary Action Statement if present */}
      {action && (
        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded font-mono text-xs text-zinc-800 dark:text-zinc-200">
          <span className="font-bold text-blue-600 dark:text-blue-400 mr-2">DIRECTIVE:</span>
          {Array.isArray(action) ? action.join('; ') : action}
        </div>
      )}

      {/* Prioritized Steps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((s, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 p-3 bg-zinc-50/60 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800/80 rounded"
          >
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
              {s.step || idx + 1}
            </div>
            <div className="font-mono text-xs">
              <div className="font-bold text-zinc-800 dark:text-zinc-200">
                {s.action}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-2">
                <span>Target: <strong>{s.target_component}</strong></span>
                {s.safety_priority && (
                  <span className="uppercase text-[9px] px-1 py-0.2 rounded bg-zinc-200 dark:bg-zinc-800">
                    {s.safety_priority} priority
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
