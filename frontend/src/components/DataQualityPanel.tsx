import React from 'react';
import type { QualityMetrics, ConnectionState, BackendStatus } from '../types/domain';
import { formatValue, formatTimestamp } from '../utils/formatters';

interface Props {
  readonly connectionState: ConnectionState;
  readonly quality: QualityMetrics;
  readonly backendStatus: BackendStatus | null;
}

export const DataQualityPanel: React.FC<Props> = ({
  connectionState,
  quality,
  backendStatus,
}) => {
  return (
    <div
      data-testid="data-quality-panel"
      className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">
            DATA QUALITY & STATISTICAL PIPELINE TELEMETRY
          </span>
        </div>
        <div className="font-mono text-[10px] text-zinc-400">
          Source: Ingestion Bus (Phase 5.5)
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono text-xs">
        {/* Connection Status */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="text-[10px] text-zinc-500 uppercase">Bus Connection</div>
          <div className={`font-bold mt-1 ${
            connectionState === 'CONNECTED' ? 'text-emerald-500' : 'text-amber-500'
          }`}>
            {connectionState}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">WebSocket</div>
        </div>

        {/* Packet Freshness */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="text-[10px] text-zinc-500 uppercase">Packet Freshness</div>
          <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {quality.packetFreshnessMs !== null ? `${quality.packetFreshnessMs} ms` : '—'}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            {quality.lastTimestamp ? formatTimestamp(quality.lastTimestamp) : 'Awaiting data'}
          </div>
        </div>

        {/* Ultrasonic Plausibility */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="text-[10px] text-zinc-500 uppercase">Distance Sensor</div>
          <div className={`font-bold mt-1 ${quality.distancePlausible ? 'text-emerald-500' : 'text-purple-400'}`}>
            {quality.distancePlausible ? 'PLAUSIBLE' : 'IMPLAUSIBLE'}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">Envelope Plausibility</div>
        </div>

        {/* Mahalanobis Distance */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="text-[10px] text-zinc-500 uppercase">Mahalanobis Dist</div>
          <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {formatValue(quality.mahalanobisDistance, 2)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">Multivariate Metric</div>
        </div>

        {/* Z-Scores */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="text-[10px] text-zinc-500 uppercase">Signal Z-Scores</div>
          <div className="font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            I:{formatValue(quality.currentZScore, 1)} / R:{formatValue(quality.rpmZScore, 1)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">Current / RPM Z</div>
        </div>

        {/* Model & Reference Bucket */}
        <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="text-[10px] text-zinc-500 uppercase">Classifier Bucket</div>
          <div className="font-bold text-zinc-900 dark:text-zinc-100 truncate mt-1" title={quality.bucketUsed || 'None'}>
            {quality.bucketUsed || 'DEFAULT'}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            LLM: {backendStatus?.active_model || 'Local Model'}
          </div>
        </div>
      </div>
    </div>
  );
};
