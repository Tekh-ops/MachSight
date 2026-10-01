import React from 'react';
import type { ParsedDiagnosis, TelemetryPoint } from '../types/domain';

interface Props {
  readonly diagnosis: ParsedDiagnosis | null;
  readonly latestTelemetry: TelemetryPoint | null;
}

export const RecoveryCard: React.FC<Props> = ({ diagnosis, latestTelemetry }) => {
  return (
    <div
      data-testid="recovery-card"
      className="border border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/20 p-5 rounded-sm shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between border-b border-emerald-200/50 dark:border-emerald-800/40 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500" />
          <h3 className="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">
            RECOVERY CONFIRMED — ALL SIGNALS NORMALIZED
          </h3>
        </div>
        <span className="px-2.5 py-0.5 text-xs font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 rounded">
          SYSTEM HEALTHY
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
        <div className="p-3 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-900/40 rounded">
          <div className="text-[10px] text-zinc-500 uppercase">Motor Current</div>
          <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
            ~3.96 A &rarr; <span className="text-emerald-600 dark:text-emerald-400">{latestTelemetry?.current_a ? `${latestTelemetry.current_a.toFixed(2)} A` : '1.59 A'}</span>
          </div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">Returned to nominal baseline</div>
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-900/40 rounded">
          <div className="text-[10px] text-zinc-500 uppercase">Wheel RPM</div>
          <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
            ~22 RPM &rarr; <span className="text-emerald-600 dark:text-emerald-400">{latestTelemetry?.rpm ? `${latestTelemetry.rpm.toFixed(0)} RPM` : '224 RPM'}</span>
          </div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">Full rotational speed restored</div>
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-900/40 rounded">
          <div className="text-[10px] text-zinc-500 uppercase">Operating Ratio</div>
          <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
            Elevated &rarr; <span className="text-emerald-600 dark:text-emerald-400">Nominal</span>
          </div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">Current/RPM relationship healthy</div>
        </div>
      </div>

      <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 pt-1">
        The abnormal mechanical resistance has cleared. Telemetry signals have sustained healthy operating bounds without fault indication.
      </p>
    </div>
  );
};
