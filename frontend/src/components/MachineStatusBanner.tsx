import React from 'react';
import type { MachineHealthStatus, TelemetryPoint, ParsedDiagnosis } from '../types/domain';
import { formatTimeAgo, formatTimestamp } from '../utils/formatters';

interface Props {
  readonly healthStatus: MachineHealthStatus;
  readonly latestTelemetry: TelemetryPoint | null;
  readonly latestDiagnosis: ParsedDiagnosis | null;
  readonly activeAnomalyCount: number;
  readonly machineId: string;
}

export const MachineStatusBanner: React.FC<Props> = ({
  healthStatus,
  latestTelemetry,
  latestDiagnosis,
  activeAnomalyCount,
  machineId,
}) => {
  const getStatusConfig = () => {
    switch (healthStatus) {
      case 'HEALTHY':
        return {
          label: 'HEALTHY',
          badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
          dotClass: 'bg-emerald-500',
          title: 'Machine Operating Normally',
          desc: 'All operating signals (current, RPM, speed) are within nominal statistical tolerances.',
        };
      case 'INVESTIGATING':
        return {
          label: 'INVESTIGATING',
          badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
          dotClass: 'bg-amber-400 animate-pulse',
          title: 'Abnormal Sensor Relationship Detected',
          desc: 'Telemetry divergence observed under throttle. Autonomous reasoning engine collecting temporal evidence window...',
        };
      case 'ANOMALY':
        return {
          label: 'ACTIVE ANOMALY',
          badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
          dotClass: 'bg-rose-500',
          title: latestDiagnosis?.primary_hypothesis?.label || latestDiagnosis?.diagnosis || 'Active Anomaly Detected',
          desc: 'Multivariate statistical anomaly detected. Causal relationships under investigation.',
        };
      case 'FAULT DETECTED':
        return {
          label: 'FAULT DETECTED',
          badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
          dotClass: 'bg-rose-500',
          title: latestDiagnosis?.primary_hypothesis?.label || latestDiagnosis?.diagnosis || 'Potential Mechanical or Sensor Fault',
          desc: latestDiagnosis?.reasoning && typeof latestDiagnosis.reasoning === 'string'
            ? latestDiagnosis.reasoning
            : 'Multi-signal evidence indicates an active equipment fault requiring inspection.',
        };
      case 'RECOVERING':
        return {
          label: 'RECOVERING',
          badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/50',
          dotClass: 'bg-sky-400 animate-pulse',
          title: 'Signals Returning Toward Baseline',
          desc: 'Sensor measurements returning toward expected operating envelope. Monitoring signal stability...',
        };
      case 'RECOVERED':
        return {
          label: 'RECOVERED',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
          dotClass: 'bg-emerald-500',
          title: 'Recovery Confirmed',
          desc: 'Abnormal condition cleared. Current, RPM, and speed have normalized to nominal baseline.',
        };
      case 'SENSOR_ISSUE':
        return {
          label: 'SENSOR FAULT',
          badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/50',
          dotClass: 'bg-purple-400 animate-pulse',
          title: 'Sensor Reporting Implausible Data',
          desc: 'Sensor signal dropped, pegged, or violated physical plausibility bounds.',
        };
      case 'OFFLINE':
      case 'UNKNOWN':
      default:
        return {
          label: 'OFFLINE',
          badgeClass: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
          dotClass: 'bg-zinc-500',
          title: 'Awaiting Telemetry Connection',
          desc: 'Waiting for live telemetry stream from machine or simulator.',
        };
    }
  };

  const config = getStatusConfig();
  const timeAgoText = latestTelemetry ? formatTimeAgo(latestTelemetry.timestamp) : 'No data';
  const lastUpdateTime = latestTelemetry ? formatTimestamp(latestTelemetry.timestamp) : '--:--:--';

  return (
    <div
      data-testid="machine-status-banner"
      className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4 transition-all"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Main Status Indicator & Diagnostic Title */}
        <div className="flex items-start sm:items-center gap-3">
          <div className="relative flex items-center justify-center mt-1 sm:mt-0">
            <span className={`w-3.5 h-3.5 rounded-full ${config.dotClass}`} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-0.5 text-xs font-mono font-bold tracking-wider rounded border ${config.badgeClass}`}>
                {config.label}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                UNIT: <strong className="text-zinc-800 dark:text-zinc-200">{machineId || 'rc-sim-01'}</strong>
              </span>
              <span className="text-zinc-400 text-xs hidden sm:inline">&bull;</span>
              <span className="text-[11px] font-mono text-zinc-500">
                Last update: {lastUpdateTime}
              </span>
            </div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-1">
              {config.title}
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 max-w-2xl">
              {config.desc}
            </p>
          </div>
        </div>

        {/* Supporting Operational Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 pt-3 lg:pt-0 lg:pl-4 shrink-0">
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Command Mode</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 uppercase mt-0.5">
              {latestTelemetry?.mode || 'IDLE'}
            </div>
            <div className="text-[10px] text-zinc-400">PWM {latestTelemetry?.pwm_command ?? 0}</div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Motor Current</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
              {latestTelemetry?.current_a !== null && latestTelemetry?.current_a !== undefined
                ? `${latestTelemetry.current_a.toFixed(2)} A`
                : '--'}
            </div>
            <div className="text-[10px] text-zinc-400">Ref ~1.60 A</div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Wheel RPM</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
              {latestTelemetry?.rpm !== null && latestTelemetry?.rpm !== undefined
                ? `${latestTelemetry.rpm.toFixed(0)} RPM`
                : '--'}
            </div>
            <div className="text-[10px] text-zinc-400">Ref ~225 RPM</div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Active Anomalies</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
              {activeAnomalyCount > 0 ? `${activeAnomalyCount} ACTIVE` : '0 (NONE)'}
            </div>
            <div className="text-[10px] text-zinc-400">
              {timeAgoText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
