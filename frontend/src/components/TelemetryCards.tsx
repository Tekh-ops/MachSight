import React from 'react';
import type { TelemetryPoint } from '../types/domain';
import { formatValue, formatTimeAgo } from '../utils/formatters';

interface Props {
  readonly latestTelemetry: TelemetryPoint | null;
  readonly highlightMetrics?: readonly string[];
  readonly isAnomaly?: boolean;
}

export const TelemetryCards: React.FC<Props> = ({
  latestTelemetry,
  highlightMetrics = [],
  isAnomaly = false,
}) => {
  const timeAgo = latestTelemetry ? formatTimeAgo(latestTelemetry.timestamp) : 'Waiting for data';

  return (
    <div
      data-testid="telemetry-cards"
      className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-sm p-4 shadow-sm"
    >
      <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-zinc-400" />
          <h3 className="font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
            LIVE TELEMETRY STREAM (SUPPORTING VIEW)
          </h3>
        </div>
        <span className="font-mono text-[11px] text-zinc-500">
          Freshness: {timeAgo}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 font-mono">
        {/* 1. Motor Current */}
        <div
          data-testid="telemetry-card-current"
          className="p-3 bg-zinc-50/60 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/80 rounded"
        >
          <div className="text-[10px] text-zinc-500 uppercase font-semibold">
            MOTOR CURRENT
          </div>
          <div className="flex items-baseline gap-1.5 my-1">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatValue(latestTelemetry?.current_a, 2)}
            </span>
            <span className="text-xs text-zinc-500">A</span>
          </div>
          <div className="text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Ref: ~1.60 A</span>
            {latestTelemetry?.current_zscore !== undefined && (
              <span>z={latestTelemetry.current_zscore.toFixed(1)}</span>
            )}
          </div>
        </div>

        {/* 2. Wheel RPM */}
        <div
          data-testid="telemetry-card-rpm"
          className="p-3 bg-zinc-50/60 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/80 rounded"
        >
          <div className="text-[10px] text-zinc-500 uppercase font-semibold">
            WHEEL RPM
          </div>
          <div className="flex items-baseline gap-1.5 my-1">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatValue(latestTelemetry?.rpm, 1)}
            </span>
            <span className="text-xs text-zinc-500">RPM</span>
          </div>
          <div className="text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Ref: ~225 RPM</span>
            {latestTelemetry?.rpm_zscore !== undefined && (
              <span>z={latestTelemetry.rpm_zscore.toFixed(1)}</span>
            )}
          </div>
        </div>

        {/* 3. Ultrasonic Distance */}
        <div
          data-testid="telemetry-card-distance"
          className="p-3 bg-zinc-50/60 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/80 rounded"
        >
          <div className="text-[10px] text-zinc-500 uppercase font-semibold">
            ULTRASONIC RANGE
          </div>
          <div className="flex items-baseline gap-1.5 my-1">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatValue(latestTelemetry?.distance_cm, 1)}
            </span>
            <span className="text-xs text-zinc-500">cm</span>
          </div>
          <div className="text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Plausible: {latestTelemetry?.distance_plausible !== 0 ? 'YES' : 'NO'}</span>
          </div>
        </div>

        {/* 4. Motor Command */}
        <div
          data-testid="telemetry-card-command"
          className="p-3 bg-zinc-50/60 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/80 rounded"
        >
          <div className="text-[10px] text-zinc-500 uppercase font-semibold">
            THROTTLE COMMAND
          </div>
          <div className="flex items-baseline gap-1.5 my-1">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 uppercase">
              {latestTelemetry?.pwm_command ? `PWM ${latestTelemetry.pwm_command}` : 'OFF'}
            </span>
          </div>
          <div className="text-[10px] text-zinc-400">
            Mode: <span className="uppercase text-zinc-600 dark:text-zinc-300 font-semibold">{latestTelemetry?.mode || 'IDLE'}</span>
          </div>
        </div>

        {/* 5. Vehicle Velocity */}
        <div
          data-testid="telemetry-card-velocity"
          className="p-3 bg-zinc-50/60 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/80 rounded"
        >
          <div className="text-[10px] text-zinc-500 uppercase font-semibold">
            VEHICLE VELOCITY
          </div>
          <div className="flex items-baseline gap-1.5 my-1">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {latestTelemetry?.velocity_mps !== null && latestTelemetry?.velocity_mps !== undefined
                ? latestTelemetry.velocity_mps.toFixed(2)
                : latestTelemetry?.rpm ? (latestTelemetry.rpm * 0.0036).toFixed(2) : '0.00'}
            </span>
            <span className="text-xs text-zinc-500">m/s</span>
          </div>
          <div className="text-[10px] text-zinc-400">
            Derived motion estimate
          </div>
        </div>
      </div>
    </div>
  );
};
