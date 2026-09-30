import React from 'react';
import type { TelemetryPoint } from '../types/domain';
import { formatValue, formatTimeAgo } from '../utils/formatters';

interface Props {
  readonly latestTelemetry: TelemetryPoint | null;
  readonly highlightMetrics: readonly string[];
  readonly isAnomaly: boolean;
}

export const TelemetryCards: React.FC<Props> = ({
  latestTelemetry,
  highlightMetrics,
  isAnomaly,
}) => {
  const isCurrentHighlighted = highlightMetrics.includes('current_a') && isAnomaly;
  const isRpmHighlighted = highlightMetrics.includes('rpm') && isAnomaly;
  const isDistHighlighted = (highlightMetrics.includes('distance_cm') && isAnomaly) ||
    (latestTelemetry?.distance_plausible === 0);

  const timeAgo = latestTelemetry ? formatTimeAgo(latestTelemetry.timestamp) : 'Waiting for telemetry...';

  return (
    <div data-testid="telemetry-cards" className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* 1. Motor Current Card */}
      <div
        data-testid="telemetry-card-current"
        className={`border p-4 bg-white dark:bg-zinc-900 shadow-sm transition-colors ${
          isCurrentHighlighted
            ? 'border-red-500 bg-red-50/10 dark:bg-red-950/20'
            : 'border-zinc-300 dark:border-zinc-800'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
              MOTOR CURRENT
            </span>
          </div>
          {isCurrentHighlighted && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/40 rounded animate-pulse">
              ANOMALOUS
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2 my-2">
          <span className="font-mono text-3xl font-extrabold text-zinc-900 dark:text-zinc-100">
            {formatValue(latestTelemetry?.current_a, 2)}
          </span>
          <span className="font-mono text-sm font-semibold text-zinc-500">A</span>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <span>Freshness: {timeAgo}</span>
          {latestTelemetry?.current_zscore !== undefined && (
            <span>Z-Score: {formatValue(latestTelemetry.current_zscore, 2)}</span>
          )}
        </div>
      </div>

      {/* 2. Wheel RPM Card */}
      <div
        data-testid="telemetry-card-rpm"
        className={`border p-4 bg-white dark:bg-zinc-900 shadow-sm transition-colors ${
          isRpmHighlighted
            ? 'border-red-500 bg-red-50/10 dark:bg-red-950/20'
            : 'border-zinc-300 dark:border-zinc-800'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
              WHEEL RPM
            </span>
          </div>
          {isRpmHighlighted && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/40 rounded animate-pulse">
              ANOMALOUS
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2 my-2">
          <span className="font-mono text-3xl font-extrabold text-zinc-900 dark:text-zinc-100">
            {formatValue(latestTelemetry?.rpm, 1)}
          </span>
          <span className="font-mono text-sm font-semibold text-zinc-500">RPM</span>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <span>Freshness: {timeAgo}</span>
          {latestTelemetry?.rpm_zscore !== undefined && (
            <span>Z-Score: {formatValue(latestTelemetry.rpm_zscore, 2)}</span>
          )}
        </div>
      </div>

      {/* 3. Ultrasonic Distance Card */}
      <div
        data-testid="telemetry-card-distance"
        className={`border p-4 bg-white dark:bg-zinc-900 shadow-sm transition-colors ${
          isDistHighlighted
            ? 'border-amber-500 bg-amber-50/10 dark:bg-amber-950/20'
            : 'border-zinc-300 dark:border-zinc-800'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
              ULTRASONIC RANGE
            </span>
          </div>
          {latestTelemetry?.distance_plausible === 0 ? (
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded">
              IMPLAUSIBLE
            </span>
          ) : isDistHighlighted ? (
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded">
              FLAGGED
            </span>
          ) : (
            <span className="px-1.5 py-0.5 text-[10px] font-mono text-emerald-500">
              PLAUSIBLE
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2 my-2">
          <span className="font-mono text-3xl font-extrabold text-zinc-900 dark:text-zinc-100">
            {formatValue(latestTelemetry?.distance_cm, 1)}
          </span>
          <span className="font-mono text-sm font-semibold text-zinc-500">cm</span>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <span>Freshness: {timeAgo}</span>
          <span>Sensor: Front Array</span>
        </div>
      </div>
    </div>
  );
};
