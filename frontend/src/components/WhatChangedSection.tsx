import React from 'react';
import type { WhatChangedItem } from '../types/domain';

interface Props {
  readonly items?: readonly WhatChangedItem[];
}

export const WhatChangedSection: React.FC<Props> = ({ items }) => {
  if (!items || items.length === 0) {
    return null;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'elevated':
        return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'collapsed':
      case 'stalled':
      case 'concerning':
        return 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30';
      case 'nominal':
      default:
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    }
  };

  return (
    <div
      data-testid="what-changed-section"
      className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-4 rounded-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <h3 className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            WHAT CHANGED FROM BASELINE?
          </h3>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          Conditioned against operating mode & commanded throttle
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 uppercase">
              <th className="py-2 pr-4 font-semibold">Signal / Feature</th>
              <th className="py-2 px-4 font-semibold">Healthy Baseline</th>
              <th className="py-2 px-4 font-semibold">Observed Value</th>
              <th className="py-2 px-4 font-semibold">Delta</th>
              <th className="py-2 pl-4 text-right font-semibold">Assessment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {items.map((item, idx) => (
              <tr key={idx} className="hover:bg-zinc-100/50 dark:hover:bg-zinc-900/50 transition-colors">
                <td className="py-2 pr-4 font-bold text-zinc-800 dark:text-zinc-200">
                  {item.metric}
                </td>
                <td className="py-2 px-4 text-zinc-500">
                  {item.baseline}
                </td>
                <td className="py-2 px-4 font-semibold text-zinc-900 dark:text-zinc-100">
                  {item.current}
                </td>
                <td className="py-2 px-4">
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">
                    {item.change}
                  </span>
                </td>
                <td className="py-2 pl-4 text-right">
                  <span className={`px-2 py-0.5 text-[10px] rounded border uppercase font-bold ${getStatusBadge(item.status)}`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
