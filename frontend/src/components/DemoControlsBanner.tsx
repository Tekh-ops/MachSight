import React, { useState } from 'react';

interface Props {
  readonly simUrl?: string;
  readonly isConnected?: boolean;
}

export const DemoControlsBanner: React.FC<Props> = ({
  simUrl = 'http://127.0.0.1:8765',
  isConnected = true,
}) => {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const notify = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleHealthyRun = async () => {
    setActiveAction('healthy');
    try {
      // 1. Ensure running and clear any active faults
      await fetch(`${simUrl}/faults/clear`, { method: 'POST' }).catch(() => {});
      await fetch(`${simUrl}/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: null, seed: 42 }),
      }).catch(() => {});
      // 2. Set steady forward cruise throttle
      await fetch(`${simUrl}/control/throttle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pwm: 200, mode: 'forward' }),
      });
      notify('Healthy Forward Cruise Initiated (PWM 200, faults cleared)');
    } catch (e) {
      notify(`Simulator offline (${e})`);
    } finally {
      setActiveAction(null);
    }
  };

  const handleInjectJam = async () => {
    setActiveAction('jam');
    try {
      const res = await fetch(`${simUrl}/faults/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'drivetrain_obstruction',
          start_s: 0.0,
          severity: 0.95,
        }),
      });
      if (res.ok) {
        notify('Injected: Drivetrain Obstruction (Current ↑, RPM ↓)');
      } else {
        notify(`Fault injection failed: ${await res.text()}`);
      }
    } catch (e) {
      notify(`Simulator offline (${e})`);
    } finally {
      setActiveAction(null);
    }
  };

  const handleInjectSensorFault = async () => {
    setActiveAction('sensor');
    try {
      const res = await fetch(`${simUrl}/faults/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'rpm_sensor_failure',
          start_s: 0.0,
          stuck_value: 0.0,
        }),
      });
      if (res.ok) {
        notify('Injected: RPM Sensor Failure (Current normal, RPM zero)');
      } else {
        notify(`Fault injection failed: ${await res.text()}`);
      }
    } catch (e) {
      notify(`Simulator offline (${e})`);
    } finally {
      setActiveAction(null);
    }
  };

  const handleClearFault = async () => {
    setActiveAction('clear');
    try {
      await fetch(`${simUrl}/faults/clear`, { method: 'POST' });
      notify('All Faults Cleared — Observing Recovery Flow');
    } catch (e) {
      notify(`Simulator offline (${e})`);
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div
      data-testid="demo-controls-banner"
      className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 p-3 rounded-sm shadow-sm flex flex-wrap items-center justify-between gap-3 font-mono text-xs"
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
        <span className="font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider text-[11px]">
          INTERACTIVE DEMO CONTROLS:
        </span>
        {feedback && (
          <span className="text-blue-600 dark:text-blue-400 font-semibold text-[11px] animate-fade-in">
            &bull; {feedback}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* 1. Start Healthy Cruise */}
        <button
          type="button"
          onClick={handleHealthyRun}
          disabled={activeAction !== null}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <span>▶</span>
          <span>Start Healthy Cruise</span>
        </button>

        {/* 2. Inject Drivetrain Obstruction */}
        <button
          type="button"
          onClick={handleInjectJam}
          disabled={activeAction !== null}
          className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <span>⚠</span>
          <span>Inject Drivetrain Jam</span>
        </button>

        {/* 3. Inject Sensor Fault */}
        <button
          type="button"
          onClick={handleInjectSensorFault}
          disabled={activeAction !== null}
          className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <span>⚡</span>
          <span>Inject Sensor Fault</span>
        </button>

        {/* 4. Clear Fault / Recovery */}
        <button
          type="button"
          onClick={handleClearFault}
          disabled={activeAction !== null}
          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-xs border border-zinc-700 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <span>✓</span>
          <span>Clear Fault (Recovery)</span>
        </button>
      </div>
    </div>
  );
};
