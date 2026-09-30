import React, { useState } from 'react';
import type { TimelineEvent } from '../types/domain';

interface Props {
  readonly events: readonly TimelineEvent[];
}

export const DiagnosticTimeline: React.FC<Props> = ({ events }) => {
  const [filter, setFilter] = useState<'ALL' | 'ANOMALIES' | 'DIAGNOSES'>('ALL');

  const filteredEvents = events.filter((ev) => {
    if (filter === 'ANOMALIES') return ev.type === 'anomaly' || ev.type === 'recovery';
    if (filter === 'DIAGNOSES') return ev.type === 'diagnosis';
    return true;
  });

  const getSeverityStyle = (severity: TimelineEvent['severity']) => {
    switch (severity) {
      case 'critical':
        return {
          dot: 'bg-red-500',
          badge: 'bg-red-500/15 text-red-400 border-red-500/40',
        };
      case 'warning':
        return {
          dot: 'bg-amber-500',
          badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
        };
      case 'nominal':
        return {
          dot: 'bg-emerald-500',
          badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
        };
      case 'info':
      default:
        return {
          dot: 'bg-blue-500',
          badge: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
        };
    }
  };

  return (
    <div
      data-testid="diagnostic-timeline"
      className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            CHRONOLOGICAL DIAGNOSTIC EVENT TIMELINE
          </span>
          <span className="text-[10px] font-mono text-zinc-500">({events.length} RECORDED)</span>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-1 font-mono text-[11px]">
          {(['ALL', 'ANOMALIES', 'DIAGNOSES'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 border ${
                filter === f
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold border-transparent'
                  : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="py-8 text-center font-mono text-xs text-zinc-400">
          No diagnostic events recorded yet. Events populate as anomalies and diagnosis steps occur.
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 max-h-96 overflow-y-auto pr-2">
          {/* Vertical connecting line */}
          <div className="absolute top-2 bottom-2 left-2.5 w-0.5 bg-zinc-200 dark:bg-zinc-800" />

          {filteredEvents.map((ev) => {
            const style = getSeverityStyle(ev.severity);
            return (
              <div key={ev.id} className="relative flex items-start gap-3">
                {/* Event timeline node */}
                <div
                  className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-900 ${style.dot}`}
                />

                <div className="flex-1 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-2.5 rounded-none">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border ${style.badge}`}>
                        {ev.type}
                      </span>
                      <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {ev.title}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-500 whitespace-nowrap">
                      {ev.timeFormatted}
                    </span>
                  </div>

                  <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {ev.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
