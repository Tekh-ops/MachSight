import React from 'react';

interface Props {
  readonly uncertainty?: readonly string[];
}

export const UncertaintySection: React.FC<Props> = ({ uncertainty }) => {
  const defaultUncertainties = [
    'Telemetry cannot determine whether mechanical resistance is caused by a blocked wheel, axle binding, or internal gear train obstruction without physical inspection.',
    'Telemetry alone cannot measure gear tooth wear or bearing friction directly.',
    'Physical hands-on inspection is required to confirm whether the root cause is foreign debris or internal hardware failure.',
  ];

  const items = uncertainty && uncertainty.length > 0 ? uncertainty : defaultUncertainties;

  return (
    <div
      data-testid="uncertainty-section"
      className="border border-zinc-200 dark:border-zinc-800 bg-amber-50/20 dark:bg-amber-950/10 p-4 rounded-sm"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-500 font-bold text-sm">⚠</span>
        <h3 className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
          WHAT MACHSIGHT CANNOT DETERMINE (BOUNDARIES & UNCERTAINTY)
        </h3>
      </div>

      <div className="font-mono text-xs text-zinc-700 dark:text-zinc-300 space-y-1.5 pl-5">
        <ul className="list-disc space-y-1">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 pt-2 border-t border-amber-200/40 dark:border-amber-900/30 text-[11px] font-mono text-zinc-500">
        AI recommendations are diagnostic advisories. Physical visual and mechanical inspection remains mandatory before returning asset to production.
      </div>
    </div>
  );
};
