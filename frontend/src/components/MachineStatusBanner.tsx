import React from 'react';
import type { MachineHealthStatus, TelemetryPoint, ParsedDiagnosis } from '../types/domain';
import { formatTimeAgo } from '../utils/formatters';

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
          label: 'NOMINAL HEALTH',
          badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
          dotClass: 'bg-emerald-500',
          desc: 'All telemetry metrics and ratios operating within nominal statistical baselines.',
        };
      case 'ATTENTION':
        return {
          label: 'ATTENTION REQUIRED',
          badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
          dotClass: 'bg-amber-400 animate-pulse',
          desc: 'Telemetry trend deviation detected. Monitoring correlation closely.',
        };
      case 'ANOMALY':
        return {
          label: 'ACTIVE ANOMALY',
          badgeClass: 'bg-red-500/20 text-red-300 border-red-500/50 shadow-sm',
          dotClass: 'bg-red-500 animate-ping',
          desc: 'Multivariate statistical anomaly detected (Mahalanobis distance threshold exceeded).',
        };
      case 'SENSOR_ISSUE':
        return {
          label: 'SENSOR ISSUE',
          badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
          dotClass: 'bg-purple-400 animate-pulse',
          desc: 'Sensor signal implausible, stuck, or dropped from expected operating envelope.',
        };
      case 'UNKNOWN':
      default:
        return {
          label: 'STANDBY / UNKNOWN',
          badgeClass: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
          dotClass: 'bg-zinc-500',
          desc: 'Waiting for continuous telemetry stream from backend.',
        };
    }
  };

  const config = getStatusConfig();
  const timeAgoText = latestTelemetry ? formatTimeAgo(latestTelemetry.timestamp) : 'No data';

  return (
    <div
      data-testid="machine-status-banner"
      className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Main Status Badge & Indicator */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <span className={`w-3.5 h-3.5 rounded-full ${config.dotClass}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 text-xs font-mono font-bold tracking-wider rounded border ${config.badgeClass}`}>
                {config.label}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                // UNIT: <strong className="text-zinc-800 dark:text-zinc-200">{machineId || 'rc-sim-01'}</strong>
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl">
              {latestDiagnosis?.diagnosis || config.desc}
            </p>
          </div>
        </div>

        {/* Supporting Operational Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 pt-3 lg:pt-0 lg:pl-4">
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Operating Mode</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 uppercase mt-0.5">
              {latestTelemetry?.mode || 'IDLE'}
            </div>
            <div className="text-[10px] text-zinc-400">PWM {latestTelemetry?.pwm_command ?? 0}</div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Active Anomalies</div>
            <div className={`font-bold mt-0.5 ${activeAnomalyCount > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
              {activeAnomalyCount > 0 ? `${activeAnomalyCount} ACTIVE` : '0 (NONE)'}
            </div>
            <div className="text-[10px] text-zinc-400">Window Count</div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Latest Diagnosis</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 truncate mt-0.5 max-w-[120px]" title={latestDiagnosis?.diagnosis || 'Nominal'}>
              {latestDiagnosis?.diagnosis ? (latestDiagnosis.stage === 'final' ? 'FINAL' : 'PRELIM') : 'NOMINAL'}
            </div>
            <div className="text-[10px] text-zinc-400">
              {latestDiagnosis?.suspected_component
                ? (typeof latestDiagnosis.suspected_component === 'object'
                    ? (latestDiagnosis.suspected_component.display_name || latestDiagnosis.suspected_component.component_id || '').toUpperCase()
                    : latestDiagnosis.suspected_component.toUpperCase())
                : 'NO FAULT'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Last Packet</div>
            <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
              {timeAgoText}
            </div>
            <div className="text-[10px] text-zinc-400">Freshness</div>
          </div>
        </div>
      </div>
    </div>
  );
};
