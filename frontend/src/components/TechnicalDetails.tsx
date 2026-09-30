import React, { useState } from 'react';
import type { TelemetryPoint, ParsedDiagnosis, BackendStatus } from '../types/domain';

interface Props {
  readonly latestTelemetry: TelemetryPoint | null;
  readonly latestDiagnosis: ParsedDiagnosis | null;
  readonly backendStatus: BackendStatus | null;
  readonly wsEndpoint: string;
}

export const TechnicalDetails: React.FC<Props> = ({
  latestTelemetry,
  latestDiagnosis,
  backendStatus,
  wsEndpoint,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      data-testid="technical-details"
      className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">
            TECHNICAL DIAGNOSTIC TRACE & WIRE PAYLOAD
          </span>
          <span className="text-[10px] font-mono text-zinc-500">[ENGINEERING INSPECTION]</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
          <span>{isOpen ? 'COLLAPSE' : 'EXPAND'}</span>
          <svg
            className={`w-4 h-4 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Latest Raw/Processed Telemetry JSON */}
            <div>
              <div className="text-[11px] font-mono font-bold text-zinc-500 mb-1">
                LATEST INGESTED TELEMETRY PACKET (JSON):
              </div>
              <pre className="p-3 bg-zinc-950 text-zinc-300 font-mono text-[11px] overflow-x-auto rounded max-h-60 border border-zinc-800">
                {latestTelemetry
                  ? JSON.stringify(latestTelemetry, null, 2)
                  : '// No telemetry packet received yet.'}
              </pre>
            </div>

            {/* Diagnostic Reasoner Payload */}
            <div>
              <div className="text-[11px] font-mono font-bold text-zinc-500 mb-1">
                LATEST DIAGNOSTIC RESULT PAYLOAD:
              </div>
              <pre className="p-3 bg-zinc-950 text-zinc-300 font-mono text-[11px] overflow-x-auto rounded max-h-60 border border-zinc-800">
                {latestDiagnosis
                  ? JSON.stringify(latestDiagnosis, null, 2)
                  : '// No diagnosis result recorded yet.'}
              </pre>
            </div>
          </div>

          {/* Backend Engine Status */}
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-600 dark:text-zinc-400 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <strong>Endpoint:</strong> {wsEndpoint}
            </div>
            <div>
              <strong>Reasoner Model:</strong> {backendStatus?.active_model || '—'}
            </div>
            <div>
              <strong>LLM Reachable:</strong>{' '}
              {backendStatus?.llm_reachable ? (
                <span className="text-emerald-500 font-bold">YES</span>
              ) : (
                <span className="text-amber-500 font-bold">NO (FALLBACK ACTIVE)</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
