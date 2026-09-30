import React, { useState, useEffect } from 'react';
import type { SimulatorStatus } from '../types/domain';

interface Props {
  readonly simUrl: string;
  readonly isConnected: boolean;
  readonly packetCount: number;
}

export const SimulatorControls: React.FC<Props> = ({ simUrl, isConnected, packetCount }) => {
  const [simStatus, setSimStatus] = useState<SimulatorStatus | null>(null);
  const [faultMessage, setFaultMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Poll simulator status periodically
  const fetchSimStatus = async () => {
    try {
      const res = await fetch(`${simUrl}/simulation/status`);
      if (res.ok) {
        const data = await res.json();
        setSimStatus(data);
      }
    } catch {
      // Simulator offline or unreachable
    }
  };

  useEffect(() => {
    fetchSimStatus();
    const interval = setInterval(fetchSimStatus, 2000);
    return () => clearInterval(interval);
  }, [simUrl]);

  const startSimulation = async () => {
    setLoading(true);
    try {
      await fetch(`${simUrl}/simulation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: null, seed: 42 }),
      });
      await fetchSimStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const stopSimulation = async () => {
    setLoading(true);
    try {
      await fetch(`${simUrl}/simulation/stop`, { method: 'POST' });
      await fetchSimStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const setThrottle = async (pwm: number, mode: string) => {
    try {
      await fetch(`${simUrl}/control/throttle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pwm, mode }),
      });
      await fetchSimStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const injectFault = async (faultType: string, params: Record<string, unknown> = {}) => {
    try {
      const res = await fetch(`${simUrl}/faults/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: faultType, start_s: 0.0, ...params }),
      });
      if (res.ok) {
        setFaultMessage(`Injected: ${faultType}`);
      } else {
        const err = await res.text();
        setFaultMessage(`Error: ${err}`);
      }
      setTimeout(() => setFaultMessage(null), 4000);
      await fetchSimStatus();
    } catch (e) {
      setFaultMessage(`Error: ${e}`);
    }
  };

  const clearFaults = async () => {
    try {
      await fetch(`${simUrl}/faults/clear`, { method: 'POST' });
      setFaultMessage('All faults cleared');
      setTimeout(() => setFaultMessage(null), 3000);
      await fetchSimStatus();
    } catch (e) {
      setFaultMessage(`Error: ${e}`);
    }
  };

  const isSimRunning = simStatus?.running ?? false;

  return (
    <div
      data-testid="simulator-controls"
      className="space-y-4"
    >
      {/* Simulator Engine Status Bar */}
      <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">
            MachSight Simulator Controller
          </div>
          <span
            className={`font-mono text-xs px-2.5 py-0.5 border ${
              isSimRunning
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'border-zinc-400 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {isSimRunning ? '● ENGINE RUNNING' : '○ ENGINE STOPPED'}
          </span>
          {faultMessage && (
            <span className="font-mono text-xs px-2 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/30">
              {faultMessage}
            </span>
          )}
        </div>

        <div className="font-mono text-xs text-zinc-500">
          Target API: <span className="text-zinc-800 dark:text-zinc-200">{simUrl}</span>
        </div>
      </div>

      {/* Start / Stop & Throttle Control */}
      <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase">
            Simulation Execution & Throttle
          </div>
          <div className="flex items-center gap-2">
            <button
              id="sim-start-btn"
              onClick={startSimulation}
              disabled={isSimRunning || loading}
              className="px-4 py-2 font-mono text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              ▶ Start Simulation
            </button>
            <button
              id="sim-stop-btn"
              onClick={stopSimulation}
              disabled={!isSimRunning || loading}
              className="px-4 py-2 font-mono text-xs font-semibold bg-red-700 hover:bg-red-800 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              ■ Stop Simulation
            </button>
          </div>
        </div>

        <div>
          <div className="font-mono text-[11px] font-bold text-zinc-500 uppercase mb-2">
            Throttle Presets
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'IDLE (0)', pwm: 0, mode: 'idle' },
              { label: 'SLOW (PWM 80)', pwm: 80, mode: 'forward' },
              { label: 'MEDIUM (PWM 150)', pwm: 150, mode: 'forward' },
              { label: 'FULL (PWM 255)', pwm: 255, mode: 'forward' },
              { label: 'REVERSE (PWM 100)', pwm: 100, mode: 'reverse' },
            ].map((t) => (
              <button
                key={t.label}
                id={`throttle-${t.pwm}-btn`}
                onClick={() => setThrottle(t.pwm, t.mode)}
                disabled={!isSimRunning}
                className="px-3 py-1.5 font-mono text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Fault Injection Panel */}
      <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
          <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase">
            Fault Injections (Controlled Hardware Scenarios)
          </div>
          <button
            id="fault-clear-btn"
            onClick={clearFaults}
            disabled={!isSimRunning}
            className="px-3 py-1 font-mono text-xs font-semibold bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            ✓ Clear All Faults
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* 1. Mechanical Drag */}
          <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
              Mechanical Drag
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Adds resistance torque. Increases current draw, decreases RPM. Simulates bearing friction.
            </p>
            <button
              id="fault-drag-btn"
              onClick={() => injectFault('motor_drag', { severity: 0.6, duration_s: 30 })}
              disabled={!isSimRunning}
              className="w-full px-3 py-1.5 font-mono text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject Drag Fault
            </button>
          </div>

          {/* 2. Drivetrain Jam */}
          <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
              Motor Jam / Stall
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Locks motor shaft. RPM drops to 0 while current spikes. Tests stall reasoning.
            </p>
            <button
              id="fault-jam-btn"
              onClick={() => injectFault('drivetrain_jam', { severity: 1.0, duration_s: 15 })}
              disabled={!isSimRunning}
              className="w-full px-3 py-1.5 font-mono text-xs font-semibold bg-red-700 hover:bg-red-800 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject Jam Fault
            </button>
          </div>

          {/* 3. Sensor Dropout */}
          <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
              Ultrasonic Dropout
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Zeros distance readings. Triggers implausible sensor envelope detection.
            </p>
            <button
              id="fault-sensor-btn"
              onClick={() => injectFault('ultrasonic_stuck', { stuck_value_cm: 0.0, severity: 1.0, duration_s: 20 })}
              disabled={!isSimRunning}
              className="w-full px-3 py-1.5 font-mono text-xs font-semibold bg-purple-700 hover:bg-purple-800 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject Sensor Dropout
            </button>
          </div>

          {/* 4. Current Offset */}
          <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
              Current Spike
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Applies +3A offset to motor current reading to trigger Mahalanobis distance anomaly.
            </p>
            <button
              id="fault-current-btn"
              onClick={() => injectFault('current_bias', { bias_a: 3.0, severity: 0.8, duration_s: 25 })}
              disabled={!isSimRunning}
              className="w-full px-3 py-1.5 font-mono text-xs font-semibold bg-orange-700 hover:bg-orange-800 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject Current Spike
            </button>
          </div>

          {/* 5. RPM Dropout */}
          <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">
              RPM Sensor Dropout
            </div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
              Drops encoder pulses while vehicle moves forward. Simulates optical encoder failure.
            </p>
            <button
              id="fault-rpm-btn"
              onClick={() => injectFault('rpm_dropout', { severity: 1.0, duration_s: 30 })}
              disabled={!isSimRunning}
              className="w-full px-3 py-1.5 font-mono text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject RPM Dropout
            </button>
          </div>
        </div>
      </div>

      {/* Backend & Ingestion Status */}
      <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm text-xs font-mono">
        <div className="font-bold text-zinc-800 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3">
          E2E Demonstration Status
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="text-[10px] text-zinc-400">WebSocket Bus</div>
            <div className={`font-bold mt-1 ${isConnected ? 'text-emerald-500' : 'text-amber-500'}`}>
              {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </div>
          </div>
          <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="text-[10px] text-zinc-400">Simulator Status</div>
            <div className={`font-bold mt-1 ${isSimRunning ? 'text-emerald-500' : 'text-zinc-500'}`}>
              {isSimRunning ? 'ACTIVE STREAM' : 'OFFLINE'}
            </div>
          </div>
          <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40">
            <div className="text-[10px] text-zinc-400">Total Ingested Packets</div>
            <div className="font-bold mt-1 text-zinc-900 dark:text-zinc-100">
              {packetCount.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
