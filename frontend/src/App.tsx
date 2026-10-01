import React, { useState, useEffect, type ReactElement } from 'react';
import type { DashboardTab } from './types/domain';
import { useMachSightWebSocket } from './hooks/useMachSightWebSocket';
import { Header } from './components/Header';
import { PrimaryDashboard } from './pages/PrimaryDashboard';
import { SimulatorControls } from './components/SimulatorControls';
import { SvgSparkline } from '../IndustrialDoctor';

export function App(): ReactElement {
  const [activeTab, setActiveTab] = useState<DashboardTab>('DASHBOARD');
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [customWs, setCustomWs] = useState<string>('ws://127.0.0.1:8000/ws');
  const simUrl = 'http://127.0.0.1:8765';

  const ws = useMachSightWebSocket(customWs);

  // Sync dark mode class with <html> element
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 font-sans selection:bg-zinc-300 dark:selection:bg-zinc-700 transition-colors duration-150">
      {/* 1. Prometheus / SCADA Application Topbar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionState={ws.connectionState}
        machineId={ws.machineId}
        lastUpdateTimestamp={ws.latestTelemetry?.timestamp ?? null}
        packetCount={ws.packetCount}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        onOpenConfig={() => setShowConfigModal(true)}
        onReconnect={ws.reconnect}
      />

      {/* Connection State Alert Banner when disconnected/reconnecting */}
      {ws.connectionState === 'DISCONNECTED' && (
        <div
          data-testid="connection-banner-disconnected"
          className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center justify-between text-xs font-mono text-red-500 max-w-[1920px] mx-auto"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>
              <strong>MachSight Backend Disconnected.</strong> Showing cached historical telemetry.
              Reconnecting automatically...
            </span>
          </div>
          <button
            onClick={ws.reconnect}
            className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold"
          >
            Retry Now
          </button>
        </div>
      )}

      {ws.connectionState === 'RECONNECTING' && (
        <div
          data-testid="connection-banner-reconnecting"
          className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2 text-xs font-mono text-amber-500 max-w-[1920px] mx-auto"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Attempting reconnection to MachSight telemetry bus ({ws.wsEndpoint})...</span>
        </div>
      )}

      {/* 2. Main Tabbed Content Area */}
      <main className="p-4 max-w-[1920px] mx-auto space-y-4">
        {/* VIEW 1: PRIMARY OPERATOR DASHBOARD */}
        {activeTab === 'DASHBOARD' && <PrimaryDashboard state={ws} />}

        {/* VIEW 2: TELEMETRY MATRIX & DETAILED SPARKLINE BUS */}
        {activeTab === 'OVERVIEW' && (
          <section className="space-y-4" data-testid="overview-tab-view">
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    DETAILED TELEMETRY SIGNAL BUS // {ws.machineId}
                  </span>
                  <div className="text-[10px] font-mono text-zinc-500">
                    Live channel values, z-scores, and high-resolution sparklines
                  </div>
                </div>
                <div className="text-xs font-mono text-zinc-500">
                  WINDOW: {ws.telemetryHistory.length} SAMPLES
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/80 text-[10px] text-zinc-500 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Channel</th>
                      <th className="py-2.5 px-3">Parameter Description</th>
                      <th className="py-2.5 px-3">Live Value</th>
                      <th className="py-2.5 px-3">Z-Score</th>
                      <th className="py-2.5 px-3">Signal Trend</th>
                      <th className="py-2.5 px-3">Channel Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {ws.telemetryHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-400 font-mono text-xs">
                          Waiting for telemetry data from backend...
                        </td>
                      </tr>
                    ) : (
                      <>
                        {/* Channel 1: Distance */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-3 px-3 font-semibold text-zinc-700 dark:text-zinc-300">
                            SIG-01.DIST
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                              Ultrasonic Range
                            </div>
                            <div className="text-[10px] text-zinc-400">Front collision array</div>
                          </td>
                          <td className="py-3 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {ws.latestTelemetry?.distance_cm ?? '—'}{' '}
                            <span className="text-zinc-400 text-xs font-normal">cm</span>
                          </td>
                          <td className="py-3 px-3 text-zinc-500">
                            {ws.latestTelemetry?.distance_plausible === 1 ? 'PLAUSIBLE' : 'IMPLAUSIBLE'}
                          </td>
                          <td className="py-3 px-3">
                            <SvgSparkline
                              data={ws.telemetryHistory
                                .map((t) => t.distance_cm)
                                .filter((v): v is number => v !== null)}
                              color="#a855f7"
                              width={160}
                              height={32}
                            />
                          </td>
                          <td className="py-3 px-3">
                            {ws.latestTelemetry?.distance_plausible === 0 ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                IMPLAUSIBLE
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                NOMINAL
                              </span>
                            )}
                          </td>
                        </tr>

                        {/* Channel 2: Current */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-3 px-3 font-semibold text-zinc-700 dark:text-zinc-300">
                            SIG-02.CURR
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                              Motor Current Draw
                            </div>
                            <div className="text-[10px] text-zinc-400">Shunt resistor inline</div>
                          </td>
                          <td className="py-3 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {ws.latestTelemetry?.current_a ?? '—'}{' '}
                            <span className="text-zinc-400 text-xs font-normal">A</span>
                          </td>
                          <td className="py-3 px-3 text-zinc-500">
                            Z: {ws.latestTelemetry?.current_zscore?.toFixed(2) ?? '—'}
                          </td>
                          <td className="py-3 px-3">
                            <SvgSparkline
                              data={ws.telemetryHistory
                                .map((t) => t.current_a)
                                .filter((v): v is number => v !== null)}
                              color="#2563eb"
                              width={160}
                              height={32}
                            />
                          </td>
                          <td className="py-3 px-3">
                            {ws.latestTelemetry?.is_anomaly === 1 ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
                                ANOMALY
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                NOMINAL
                              </span>
                            )}
                          </td>
                        </tr>

                        {/* Channel 3: RPM */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-3 px-3 font-semibold text-zinc-700 dark:text-zinc-300">
                            SIG-03.RPM
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                              Wheel RPM
                            </div>
                            <div className="text-[10px] text-zinc-400">Optical tachometer</div>
                          </td>
                          <td className="py-3 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {ws.latestTelemetry?.rpm ?? '—'}{' '}
                            <span className="text-zinc-400 text-xs font-normal">RPM</span>
                          </td>
                          <td className="py-3 px-3 text-zinc-500">
                            Z: {ws.latestTelemetry?.rpm_zscore?.toFixed(2) ?? '—'}
                          </td>
                          <td className="py-3 px-3">
                            <SvgSparkline
                              data={ws.telemetryHistory
                                .map((t) => t.rpm)
                                .filter((v): v is number => v !== null)}
                              color="#10b981"
                              width={160}
                              height={32}
                            />
                          </td>
                          <td className="py-3 px-3">
                            {ws.latestTelemetry?.is_anomaly === 1 ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
                                ANOMALY
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                NOMINAL
                              </span>
                            )}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* VIEW 3: AI DIAGNOSTICS & TRACE FINDINGS */}
        {activeTab === 'DIAGNOSTICS' && (
          <section className="space-y-4" data-testid="diagnostics-tab-view">
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
                <div className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200">
                  AI Investigation Findings & Trace Archive ({ws.diagnosisHistory.length} Recorded)
                </div>
                <div className="font-mono text-xs text-zinc-500">
                  Active Model: {ws.backendStatus?.active_model || 'qwen2.5:3b-instruct'}
                </div>
              </div>

              {ws.diagnosisHistory.length === 0 ? (
                <div className="py-12 text-center font-mono text-xs text-zinc-400">
                  No diagnostic findings logged yet. Diagnoses are generated automatically when
                  anomalies occur.
                </div>
              ) : (
                <div className="space-y-3">
                  {ws.diagnosisHistory.map((d, i) => (
                    <div
                      key={d.trace_id || i}
                      className="border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded border uppercase ${
                              d.severity === 'critical'
                                ? 'bg-red-500/20 text-red-400 border-red-500/40'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}
                          >
                            {d.severity}
                          </span>
                          <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            {d.diagnosis}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-zinc-500">
                          {d.suspected_component && (
                            <span className="mr-3 text-blue-500 font-bold">
                              COMPONENT:{' '}
                              {(typeof d.suspected_component === 'object'
                                ? d.suspected_component.display_name || d.suspected_component.component_id || ''
                                : d.suspected_component
                              ).toUpperCase()}
                            </span>
                          )}
                          STAGE: {d.stage || 'final'}
                        </div>
                      </div>

                      <div className="text-xs font-mono text-zinc-700 dark:text-zinc-300">
                        <strong>Reasoning:</strong>{' '}
                        {typeof d.reasoning === 'string'
                          ? d.reasoning
                          : Array.isArray(d.reasoning)
                          ? d.reasoning.map((r: any) => (typeof r === 'string' ? r : r?.statement || JSON.stringify(r))).join(' ')
                          : ''}
                      </div>

                      {d.evidence_used && d.evidence_used.length > 0 && (
                        <div className="text-[11px] font-mono text-zinc-500 pl-4 border-l-2 border-zinc-300 dark:border-zinc-700">
                          <strong>Evidence:</strong> {d.evidence_used.join('; ')}
                        </div>
                      )}

                      {d.recommended_action && (
                        <div className="text-xs font-mono text-blue-600 dark:text-blue-400">
                          <strong>Action:</strong>{' '}
                          {Array.isArray(d.recommended_action)
                            ? d.recommended_action.join('; ')
                            : d.recommended_action}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* VIEW 4: SYSTEM EVENT LOGS */}
        {activeTab === 'LOGS' && (
          <section className="space-y-4" data-testid="logs-tab-view">
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4">
              <div className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
                Telemetry Bus Event Stream ({ws.timelineEvents.length} Events)
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {ws.timelineEvents.length === 0 ? (
                  <div className="py-8 text-center font-mono text-xs text-zinc-400">
                    No log events buffered yet.
                  </div>
                ) : (
                  ws.timelineEvents.map((e) => (
                    <div
                      key={e.id}
                      className="p-2 border border-zinc-200 dark:border-zinc-800 font-mono text-xs flex items-center justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-950/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500">{e.timeFormatted}</span>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200 uppercase">
                          [{e.type}]
                        </span>
                        <span className="text-zinc-700 dark:text-zinc-300">{e.title}:</span>
                        <span className="text-zinc-500">{e.description}</span>
                      </div>
                      <span className="text-[10px] text-zinc-400 uppercase font-bold shrink-0">
                        {e.severity}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* VIEW 5: SIMULATOR CONTROL PANEL */}
        {activeTab === 'SIMULATOR' && (
          <section className="space-y-4" data-testid="simulator-tab-view">
            <SimulatorControls
              simUrl={simUrl}
              isConnected={ws.connectionState === 'CONNECTED'}
              packetCount={ws.packetCount}
            />
          </section>
        )}
      </main>

      {/* IO Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 p-6 max-w-md w-full shadow-lg font-mono text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
              <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                WebSocket Ingestion Configuration
              </span>
              <button onClick={() => setShowConfigModal(false)} className="text-zinc-400 hover:text-zinc-200">
                ✕
              </button>
            </div>

            <div>
              <label className="block text-zinc-500 mb-1">Telemetry Bus Endpoint URL</label>
              <input
                type="text"
                value={customWs}
                onChange={(e) => setCustomWs(e.target.value)}
                className="w-full p-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  ws.setCustomWsEndpoint(customWs);
                  setShowConfigModal(false);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold"
              >
                Apply & Reconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
