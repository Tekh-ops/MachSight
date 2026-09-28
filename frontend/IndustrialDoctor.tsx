import React, { useState, useEffect, useMemo, useRef, type ReactElement } from 'react';

// ============================================================================
// 1. TYPE DEFINITIONS & DOMAIN SCHEMAS
// ============================================================================

export type OperationalStatus = 'NOMINAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
export type DiagnosticSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type DiagnosticStatus = 'PENDING_ACK' | 'TRIAGED' | 'DISPATCHED' | 'RESOLVED';
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'CRIT';
export type SubsystemType =
  | 'DRIVETRAIN'
  | 'MOTOR_ASSEMBLY'
  | 'ULTRASONIC_ARRAY'
  | 'POWER_TRAIN'
  | 'THERMAL_LOOP'
  | 'VISION_INSPECT';
export type DashboardTab = 'LANDING' | 'OVERVIEW' | 'DIAGNOSTICS' | 'LOGS';
export type LogFilterSeverity = 'ALL' | 'CRIT' | 'WARN';

// RC Car Telemetry Point (from backend)
export interface TelemetryPoint {
  readonly time: string;
  readonly distance_cm: number;
  readonly current_a: number;
  readonly rpm: number;
  readonly mode: string;
  readonly pwm_command: number;
}

// Backend WebSocket Event Types
export interface WebSocketProcessedEvent {
  readonly type: 'processed';
  readonly event: 'processed';
  readonly data: {
    readonly raw_id: number;
    readonly timestamp: number;
    readonly current_rpm_ratio: number;
    readonly current_zscore: number;
    readonly rpm_zscore: number;
    readonly mahalanobis_distance: number;
    readonly distance_plausible: number;
    readonly bucket_used: string;
    readonly is_anomaly: number;
    readonly id: number;
  };
}

export interface WebSocketInvestigationStepEvent {
  readonly type: 'investigation_step';
  readonly event: 'investigation_step';
  readonly data: {
    readonly trace_id: string;
    readonly timestamp: number;
    readonly step_type: 'reasoning';
    readonly payload: string; // JSON string requiring second parse
  };
}

export interface WebSocketDiagnosisEvent {
  readonly type: 'diagnosis';
  readonly event: 'diagnosis';
  readonly data: {
    readonly trace_id: string;
    readonly timestamp: number;
    readonly step_type: 'diagnosis';
    readonly payload: string; // JSON string requiring second parse
  };
}

export type WebSocketEvent = WebSocketProcessedEvent | WebSocketInvestigationStepEvent | WebSocketDiagnosisEvent;

// Parsed payload from investigation_step or diagnosis events
export interface ParsedPayload {
  readonly action: string;
  readonly reasoning: string;
  readonly diagnosis: string | null;
  readonly confidence: number | null;
  readonly evidence_used: readonly string[];
  readonly recommended_action: string | null;
  readonly more_data: {
    readonly seconds: number;
    readonly focus: string;
  } | null;
  readonly severity: 'warning' | 'critical' | 'info';
  readonly ui_hints: {
    readonly highlight_metrics: readonly string[];
    readonly suggested_charts: readonly string[];
  };
  readonly stage?: 'preliminary' | 'final';
}

export interface MachineUnit {
  readonly id: string;
  readonly tag: string;
  readonly name: string;
  readonly area: string;
  readonly status: OperationalStatus;
  readonly runtimeHours: number;
  readonly healthIndex: number; // 0-100
  readonly lastAnomaly: string;
  readonly telemetry: readonly TelemetryPoint[];
  readonly activeAlertCount: number;
  readonly connected: boolean;
}

export interface LogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly machineId: string;
  readonly level: LogSeverity;
  readonly subsystem: SubsystemType;
  readonly message: string;
  readonly metricTrigger?: string;
}

export interface DiagnosticFinding {
  readonly id: string;
  readonly timestamp: string;
  readonly machineId: string;
  readonly severity: DiagnosticSeverity;
  readonly confidence: number;
  readonly title: string;
  readonly rootCauseHypothesis: string;
  readonly evidencePoints: readonly string[];
  readonly recommendedAction: string;
  readonly status: DiagnosticStatus;
  readonly stage?: 'preliminary' | 'final';
  readonly traceId?: string;
}

// Component Prop Types
export interface SvgSparklineProps {
  readonly data: readonly number[];
  readonly color?: string;
  readonly height?: number;
  readonly width?: number;
  readonly minVal?: number;
  readonly maxVal?: number;
  readonly fill?: boolean;
  readonly showMinMax?: boolean;
  readonly unit?: string;
}

export interface StatusBadgeProps {
  readonly status: OperationalStatus;
}

export interface LogLevelBadgeProps {
  readonly level: LogSeverity;
}

export interface HeaderProps {
  readonly activeTab: DashboardTab;
  readonly setActiveTab: (tab: DashboardTab) => void;
  readonly darkMode: boolean;
  readonly setDarkMode: (dark: boolean) => void;
  readonly streamActive: boolean;
  readonly setStreamActive: (active: boolean) => void;
  readonly packetCount: number;
  readonly activeAlertCount: number;
  readonly aiAnalysisRunning: boolean;
  readonly triggerManualDiagnostics: () => void;
  readonly onOpenIoConfig: () => void;
  readonly isConnected: boolean;
  readonly deviceConnected: boolean;
  readonly onOpenDeviceDialog: () => void;
}

export interface IoConfigModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly wsEndpoint: string;
  readonly setWsEndpoint: (endpoint: string) => void;
  readonly streamActive: boolean;
  readonly isConnected: boolean;
}

export interface DeviceConnectionDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConnect: (deviceId: string) => void;
  readonly deviceConnected: boolean;
}

// ============================================================================
// 2. EMPTY STATE INITIALIZATION (No mock data - driven by backend)
// ============================================================================

const INITIAL_MACHINES: readonly MachineUnit[] = [
  {
    id: 'RC-01',
    tag: 'CAR-PROTO-01',
    name: 'RC Car Test Unit Alpha',
    area: 'Test Track Zone A',
    status: 'OFFLINE',
    healthIndex: 0,
    runtimeHours: 0,
    lastAnomaly: 'Device not connected',
    activeAlertCount: 0,
    telemetry: [],
    connected: false,
  },
];

const INITIAL_LOGS: readonly LogEntry[] = [];

const INITIAL_FINDINGS: readonly DiagnosticFinding[] = [];

// ============================================================================
// 3. MODULAR SUB-COMPONENTS (Badges, Sparklines, Nav, Dialogs)
// ============================================================================

export function StatusBadge({ status }: StatusBadgeProps): ReactElement {
  switch (status) {
    case 'NOMINAL':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
          <span className="w-1.5 h-1.5 mr-1 rounded-full bg-emerald-500 animate-pulse" />
          NOMINAL
        </span>
      );
    case 'WARNING':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
          <span className="w-1.5 h-1.5 mr-1 rounded-full bg-amber-500" />
          WARN_THRESH
        </span>
      );
    case 'CRITICAL':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wide bg-red-100 text-red-800 border border-red-400 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800 animate-pulse">
          <span className="w-1.5 h-1.5 mr-1 rounded-full bg-red-600" />
          CRIT_ALARM
        </span>
      );
    case 'OFFLINE':
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide bg-zinc-100 text-zinc-600 border border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
          OFFLINE
        </span>
      );
  }
}

export function LogLevelBadge({ level }: LogLevelBadgeProps): ReactElement {
  switch (level) {
    case 'CRIT':
      return <span className="font-mono text-[10px] font-bold text-red-600 dark:text-red-400">CRIT</span>;
    case 'WARN':
      return <span className="font-mono text-[10px] font-bold text-amber-600 dark:text-amber-400">WARN</span>;
    case 'INFO':
      return <span className="font-mono text-[10px] font-medium text-blue-600 dark:text-blue-400">INFO</span>;
    case 'DEBUG':
      return <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">DBUG</span>;
  }
}

export function SvgSparkline({
  data,
  color = '#2563eb',
  height = 36,
  width = 160,
  minVal,
  maxVal,
  fill = false,
  showMinMax = false,
  unit = '',
}: SvgSparklineProps): ReactElement {
  if (!data || data.length < 2) {
    return <div className="text-[10px] text-zinc-400 font-mono">No Data Stream</div>;
  }

  const computedMin = minVal !== undefined ? minVal : Math.min(...data);
  const computedMax = maxVal !== undefined ? maxVal : Math.max(...data);
  const range = computedMax - computedMin === 0 ? 1 : computedMax - computedMin;
  const paddingY = 4;
  const effectiveH = height - paddingY * 2;

  const points = data
    .map((val: number, idx: number) => {
      const x = (idx / (data.length - 1)) * width;
      const normalizedY = (val - computedMin) / range;
      const y = height - paddingY - normalizedY * effectiveH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const lastVal = data[data.length - 1] ?? 0;
  const firstVal = data[0] ?? 0;
  const delta = lastVal - firstVal;

  return (
    <div className="inline-flex items-center gap-2">
      <div className="relative">
        <svg
          width={width}
          height={height}
          className="overflow-visible block"
          style={{ shapeRendering: 'geometricPrecision' }}
        >
          <line
            x1="0"
            y1={paddingY}
            x2={width}
            y2={paddingY}
            stroke="currentColor"
            strokeDasharray="2 3"
            className="text-zinc-300 dark:text-zinc-700 opacity-60"
            strokeWidth="0.75"
          />
          <line
            x1="0"
            y1={height - paddingY}
            x2={width}
            y2={height - paddingY}
            stroke="currentColor"
            strokeDasharray="2 3"
            className="text-zinc-300 dark:text-zinc-700 opacity-60"
            strokeWidth="0.75"
          />

          {fill && (
            <polygon
              points={`0,${height - paddingY} ${points} ${width},${height - paddingY}`}
              fill={color}
              fillOpacity={0.12}
            />
          )}

          <polyline
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />

          <circle
            cx={width.toFixed(1)}
            cy={(height - paddingY - ((lastVal - computedMin) / range) * effectiveH).toFixed(1)}
            r="2.5"
            fill={color}
          />
        </svg>
      </div>

      {showMinMax && (
        <div className="flex flex-col text-[9px] font-mono leading-tight text-zinc-500 dark:text-zinc-400 min-w-[58px]">
          <span className="text-zinc-900 dark:text-zinc-200 font-semibold">
            {lastVal}
            <span className="text-zinc-400 dark:text-zinc-500 ml-0.5">{unit}</span>
          </span>
          <span className={delta >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
            {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

export function DashboardHeader({
  activeTab,
  setActiveTab,
  darkMode,
  setDarkMode,
  streamActive,
  setStreamActive,
  packetCount,
  activeAlertCount,
  aiAnalysisRunning,
  triggerManualDiagnostics,
  onOpenIoConfig,
  isConnected,
  deviceConnected,
  onOpenDeviceDialog,
}: HeaderProps): ReactElement {
  return (
    <header className="border-b border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-40">
      <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 flex items-center justify-center font-mono font-bold text-xs rounded-sm">
              ID
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono text-sm">
                  IndustrialDoctor
                </span>
                <span className="px-1 py-0.2 bg-zinc-200 dark:bg-zinc-800 text-[9px] font-mono text-zinc-600 dark:text-zinc-400 rounded">
                  v4.1.8-PROD
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">SCADA AI Diagnostic Agent // Host: plant-master-01</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-4 pl-4 border-l border-zinc-200 dark:border-zinc-800 font-mono text-[11px]">
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">BUFFER:</span>
              <span className="text-zinc-800 dark:text-zinc-200 font-semibold">{packetCount.toLocaleString()} pkts</span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">STREAM:</span>
              <span className={isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {isConnected ? 'LIVE (WebSocket)' : 'DISCONNECTED'}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">DEVICE:</span>
              <span className={deviceConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {deviceConnected ? 'CONNECTED' : 'NOT CONNECTED'}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">Alerts Active:</span>
              <span className="text-red-700 dark:text-red-400 font-bold">{activeAlertCount}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenDeviceDialog}
            disabled={deviceConnected}
            className={`px-2 py-1 font-mono text-[11px] rounded border transition-colors ${
              deviceConnected
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
            }`}
          >
            {deviceConnected ? 'Device Connected' : 'Connect Device'}
          </button>

          <button
            onClick={() => setStreamActive(!streamActive)}
            disabled={!deviceConnected}
            title="Pause or resume live sensor packet ingestion loop"
            className={`px-2 py-1 font-mono text-[11px] rounded border transition-colors flex items-center gap-1.5 ${
              streamActive && deviceConnected
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'border-zinc-400 bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${streamActive && deviceConnected ? 'bg-emerald-600 animate-ping' : 'bg-zinc-400'}`} />
            {streamActive && deviceConnected ? 'Stream Active' : 'Stream Paused'}
          </button>

          <button
            onClick={triggerManualDiagnostics}
            disabled={aiAnalysisRunning || !deviceConnected}
            className="px-2.5 py-1 font-mono text-[11px] font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 rounded border border-transparent disabled:opacity-50 flex items-center gap-1.5"
          >
            {aiAnalysisRunning ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Synthesizing...
              </>
            ) : (
              'Trigger AI Audit'
            )}
          </button>

          <button
            onClick={onOpenIoConfig}
            className="px-2 py-1 font-mono text-[11px] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-50 dark:hover:bg-zinc-750"
          >
            IO_CFG
          </button>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="px-2 py-1 font-mono text-[11px] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-50 dark:hover:bg-zinc-750 flex items-center gap-1"
            aria-label="Toggle Theme"
          >
            <span className="font-semibold">{darkMode ? 'THEME: DARK' : 'THEME: LIGHT'}</span>
          </button>
        </div>
      </div>

      <nav className="px-4 flex items-center gap-1 border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/60 overflow-x-auto text-xs">
        {(
          [
            { id: 'LANDING', label: 'System Gateway' },
            { id: 'OVERVIEW', label: '[1] Telemetry Matrix' },
            { id: 'DIAGNOSTICS', label: '[2] AI Diagnostics' },
            { id: 'LOGS', label: '[3] Event Logs' },
          ] as { readonly id: DashboardTab; readonly label: string; readonly tag?: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 font-mono font-medium border-b-2 tracking-wide transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-white dark:bg-zinc-800/80'
                : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
            {tab.tag ? (
              <span className="px-1 py-0.1 text-[9px] bg-zinc-200 dark:bg-zinc-700 rounded font-bold">
                {tab.tag}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </header>
  );
}

export function IoConfigModal({
  isOpen,
  onClose,
  wsEndpoint,
  setWsEndpoint,
  streamActive,
  isConnected,
}: IoConfigModalProps): ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-400 dark:border-zinc-700 w-full max-w-lg p-5 font-mono text-xs shadow-2xl">
        <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
            WebSocket Configuration
          </span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-bold"
          >
            [X]
          </button>
        </div>

        <p className="text-xs font-sans text-zinc-600 dark:text-zinc-400 mb-4">
          Configure WebSocket connection to MachSight backend for real-time RC car telemetry and AI diagnosis events.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">
              WebSocket Endpoint
            </label>
            <input
              type="text"
              value={wsEndpoint}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWsEndpoint(e.target.value)}
              className="w-full p-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="bg-zinc-100 dark:bg-zinc-950 p-2.5 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 space-y-1">
            <div>Backend API: MachSight FastAPI WebSocket</div>
            <div>Event Types: processed, investigation_step, diagnosis</div>
            <div>Connection Status: {isConnected ? 'CONNECTED' : 'DISCONNECTED'}</div>
            <div>Stream State: {streamActive ? 'ACTIVE' : 'PAUSED'}</div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs border border-zinc-300 dark:border-zinc-700"
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              onClose();
            }}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs border border-blue-900"
          >
            Apply Configuration
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeviceConnectionDialog({
  isOpen,
  onClose,
  onConnect,
  deviceConnected,
}: DeviceConnectionDialogProps): ReactElement | null {
  const [deviceId, setDeviceId] = useState<string>('RC-01');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-400 dark:border-zinc-700 w-full max-w-md p-5 font-mono text-xs shadow-2xl">
        <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
            Device Connection
          </span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-bold"
          >
            [X]
          </button>
        </div>

        <p className="text-xs font-sans text-zinc-600 dark:text-zinc-400 mb-4">
          Connect to an RC car device to begin streaming real-time telemetry and AI diagnosis data.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">
              Device ID
            </label>
            <input
              type="text"
              value={deviceId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeviceId(e.target.value)}
              placeholder="e.g., RC-01"
              className="w-full p-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="bg-zinc-100 dark:bg-zinc-950 p-2.5 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 space-y-1">
            <div>Available Devices: RC-01, RC-02</div>
            <div>Connection Protocol: WebSocket</div>
            <div>Status: {deviceConnected ? 'ALREADY CONNECTED' : 'NOT CONNECTED'}</div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs border border-zinc-300 dark:border-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConnect(deviceId);
              onClose();
            }}
            disabled={deviceConnected}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs border border-blue-900 disabled:opacity-50"
          >
            Connect Device
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 4. MAIN DASHBOARD CONTAINER COMPONENT
// ============================================================================

export default function IndustrialDoctorApp(): ReactElement {
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>('LANDING');
  const [machines, setMachines] = useState<readonly MachineUnit[]>(INITIAL_MACHINES);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('RC-01');
  const [logs, setLogs] = useState<readonly LogEntry[]>(INITIAL_LOGS);
  const [findings, setFindings] = useState<readonly DiagnosticFinding[]>(INITIAL_FINDINGS);
  const [streamActive, setStreamActive] = useState<boolean>(false);
  const [packetCount, setPacketCount] = useState<number>(0);
  const [activeFilterSeverity, setActiveFilterSeverity] = useState<LogFilterSeverity>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aiAnalysisRunning, setAiAnalysisRunning] = useState<boolean>(false);
  const [wsEndpoint, setWsEndpoint] = useState<string>('ws://localhost:8000/ws');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showDeviceDialog, setShowDeviceDialog] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [deviceConnected, setDeviceConnected] = useState<boolean>(false);
  const [currentDiagnosis, setCurrentDiagnosis] = useState<ParsedPayload | null>(null);
  const [highlightMetrics, setHighlightMetrics] = useState<readonly string[]>([]);
  const [anomalyDetected, setAnomalyDetected] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const telemetryBufferRef = useRef<Map<string, TelemetryPoint[]>>(new Map());

  // Initialize telemetry buffer for each machine
  useEffect(() => {
    const buffer = new Map<string, TelemetryPoint[]>();
    machines.forEach((machine) => {
      buffer.set(machine.id, [...machine.telemetry]);
    });
    telemetryBufferRef.current = buffer;
  }, [machines]);

  // Handle device connection
  const handleDeviceConnect = (deviceId: string) => {
    setDeviceConnected(true);
    setSelectedMachineId(deviceId);
    setStreamActive(true);
    
    // Update machine status
    setMachines((prev) =>
      prev.map((m) =>
        m.id === deviceId
          ? { ...m, connected: true, status: 'NOMINAL' }
          : m
      )
    );
  };

  // WebSocket connection with exponential backoff
  useEffect(() => {
    if (!streamActive || !deviceConnected) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;

    const connectWebSocket = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      try {
        const ws = new WebSocket(wsEndpoint);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('WebSocket connected to', wsEndpoint);
          setIsConnected(true);
          reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data: WebSocketEvent = JSON.parse(event.data);

            // Handle different event types
            if (data.type === 'processed' && data.data) {
              // Rate limit only high-frequency telemetry/processed events to max 10Hz.
              const now = Date.now();
              if (now - lastUpdateTimeRef.current < 100) {
                return;
              }
              lastUpdateTimeRef.current = now;
              // Update packet count
              setPacketCount((prev) => prev + 1);

              // Update anomaly status
              if (data.data.is_anomaly === 1) {
                setAnomalyDetected(true);
              } else {
                setAnomalyDetected(false);
              }
            } else if ((data.type === 'investigation_step' || data.type === 'diagnosis') && data.data?.payload) {
              // Double-encoded JSON: parse the payload string
              try {
                const parsedPayload: ParsedPayload = JSON.parse(data.data.payload);

                // Add investigation step to logs
                if (data.type === 'investigation_step') {
                  const newLogEntry: LogEntry = {
                    id: `log-${Date.now()}-${Math.floor(Math.random() * 999)}`,
                    timestamp: new Date(data.data.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19),
                    machineId: selectedMachineId,
                    level: parsedPayload.severity === 'critical' ? 'CRIT' : 'WARN',
                    subsystem: 'VISION_INSPECT',
                    message: parsedPayload.reasoning,
                    metricTrigger: parsedPayload.evidence_used.join(', '),
                  };
                  setLogs((prev) => [newLogEntry, ...prev.slice(0, 99)]);
                }

                if (data.type === 'diagnosis') {
                  setCurrentDiagnosis(parsedPayload);
                  setAiAnalysisRunning(false);

                  // Add to findings for both preliminary and final diagnoses
                  if (parsedPayload.diagnosis && parsedPayload.diagnosis !== 'inconclusive') {
                    const newFinding: DiagnosticFinding = {
                      id: `DIAG-${Date.now()}`,
                      timestamp: new Date(data.data.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
                      machineId: selectedMachineId,
                      severity: parsedPayload.severity === 'critical' ? 'HIGH' : 'MEDIUM',
                      confidence: parsedPayload.confidence || 0,
                      title: parsedPayload.diagnosis,
                      rootCauseHypothesis: parsedPayload.reasoning,
                      evidencePoints: parsedPayload.evidence_used,
                      recommendedAction: parsedPayload.recommended_action || 'No action recommended',
                      status: 'PENDING_ACK',
                      stage: parsedPayload.stage,
                      traceId: data.data.trace_id,
                    };
                    setFindings((prev) => [newFinding, ...prev]);
                  }
                }

                // Update highlight metrics from UI hints
                if (parsedPayload.ui_hints?.highlight_metrics) {
                  setHighlightMetrics(parsedPayload.ui_hints.highlight_metrics);
                }
              } catch (parseError) {
                console.error('Failed to parse payload:', parseError);
              }
            }
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setIsConnected(false);
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          wsRef.current = null;

          // Exponential backoff reconnection
          if (reconnectAttempts < maxReconnectAttempts && streamActive && deviceConnected) {
            const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
          }
        };
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        setIsConnected(false);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsEndpoint, streamActive, deviceConnected, selectedMachineId]);

  // Sync dark class to DOM root
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Selected Machine with Fallback
  const currentMachine: MachineUnit = useMemo(() => {
    return machines.find((m: MachineUnit) => m.id === selectedMachineId) ?? machines[0]!;
  }, [machines, selectedMachineId]);

  // No mock data generation - all data comes from WebSocket
  // Telemetry will be populated when device is connected and backend sends data

  // Trigger AI Audit (placeholder - real diagnosis comes from WebSocket)
  const triggerManualDiagnostics = (): void => {
    setAiAnalysisRunning(true);
    // In real implementation, this would send a request to backend to trigger investigation
    // For now, we'll just show loading state
    setTimeout(() => {
      setAiAnalysisRunning(false);
      setActiveTab('DIAGNOSTICS');
    }, 1200);
  };

  // Filtered SCADA Logs
  const filteredLogs: readonly LogEntry[] = useMemo(() => {
    return logs.filter((log: LogEntry) => {
      const matchesSev =
        activeFilterSeverity === 'ALL'
          ? true
          : activeFilterSeverity === 'CRIT'
          ? log.level === 'CRIT'
          : log.level === 'WARN' || log.level === 'CRIT';

      const matchesSearch =
        searchQuery.trim() === ''
          ? true
          : log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
            log.machineId.toLowerCase().includes(searchQuery.toLowerCase()) ||
            log.subsystem.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesSev && matchesSearch;
    });
  }, [logs, activeFilterSeverity, searchQuery]);

  const activeAlertCount = useMemo(() => {
    return machines.reduce((acc: number, curr: MachineUnit) => acc + curr.activeAlertCount, 0);
  }, [machines]);

  const currentLatestPoint = currentMachine.telemetry[currentMachine.telemetry.length - 1]!;

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 font-sans selection:bg-zinc-300 dark:selection:bg-zinc-700 transition-colors duration-150">
      {/* 1. Prometheus / SCADA Application Header */}
      <DashboardHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        streamActive={streamActive}
        setStreamActive={setStreamActive}
        packetCount={packetCount}
        activeAlertCount={activeAlertCount}
        aiAnalysisRunning={aiAnalysisRunning}
        triggerManualDiagnostics={triggerManualDiagnostics}
        onOpenIoConfig={() => setShowConfigModal(true)}
        isConnected={isConnected}
        deviceConnected={deviceConnected}
        onOpenDeviceDialog={() => setShowDeviceDialog(true)}
      />

      {/* 2. Main Dashboard Content Views */}
      <main className="p-4 max-w-[1920px] mx-auto space-y-4">
        {/* VIEW 0: SYSTEM LANDING GATEWAY */}
        {activeTab === 'LANDING' && (
          <section className="space-y-4">
            {!deviceConnected ? (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center">
                <div className="max-w-md mx-auto">
                  <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2">
                    No Device Connected
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
                    Connect an RC car device to begin streaming real-time telemetry and AI diagnosis data.
                  </p>
                  <button
                    onClick={() => setShowDeviceDialog(true)}
                    className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm"
                  >
                    Connect Device
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 rounded-none shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
                  <div>
                    <div className="font-mono text-xs text-blue-700 dark:text-blue-400 font-semibold mb-1">
                      System Overview // RC Car Diagnostic Agent
                    </div>
                    <h1 className="text-2xl font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-100">
                      RC Car Telemetry & AI Diagnostic Engine
                    </h1>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 font-sans mt-1 max-w-3xl leading-relaxed">
                      Real-time autonomous inference platform monitoring RC car telemetry with AI-powered
                      anomaly detection and diagnosis. Continuous multi-modal telemetry correlation including
                      motor current, wheel RPM, ultrasonic distance, and PWM command analysis.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveTab('OVERVIEW')}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm"
                    >
                      View Telemetry &rarr;
                    </button>
                    <button
                      onClick={() => setActiveTab('DIAGNOSTICS')}
                      className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs border border-zinc-300 dark:border-zinc-700"
                    >
                      AI Diagnostics
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-5">
                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                    <div className="text-[10px] font-mono text-zinc-500 uppercase">Device Status</div>
                    <div className="text-xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1">CONNECTED</div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{selectedMachineId}</div>
                  </div>
                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                    <div className="text-[10px] font-mono text-zinc-500 uppercase">Telemetry Packets</div>
                    <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">{packetCount.toLocaleString()}</div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-0.5">Processed events</div>
                  </div>
                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                    <div className="text-[10px] font-mono text-zinc-500 uppercase">Active Diagnoses</div>
                    <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">{findings.length}</div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-0.5">AI findings</div>
                  </div>
                  <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                    <div className="text-[10px] font-mono text-zinc-500 uppercase">Connection</div>
                    <div className="text-xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1">WEBSOCKET</div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-0.5">Live stream</div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* VIEW 1: TELEMETRY MATRIX (OVERVIEW) */}
        {activeTab === 'OVERVIEW' && (
          <section className="space-y-4">
            {!deviceConnected ? (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center">
                <div className="max-w-md mx-auto">
                  <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2">
                    No Telemetry Data Available
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
                    Connect a device to view real-time RC car telemetry data.
                  </p>
                  <button
                    onClick={() => setShowDeviceDialog(true)}
                    className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm"
                  >
                    Connect Device
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono font-bold text-zinc-500 uppercase">Active Unit:</span>
                      <div className="flex flex-wrap gap-1">
                        {machines.map((m: MachineUnit) => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedMachineId(m.id)}
                            className={`px-2.5 py-1 font-mono text-xs font-semibold border transition-colors ${
                              selectedMachineId === m.id
                                ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                                : 'bg-zinc-50 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-750'
                            }`}
                          >
                            {m.id} [{m.tag}]
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-zinc-500">STATUS:</span>
                      <StatusBadge status={currentMachine.status} />
                      <span className="text-zinc-500 ml-2">HEALTH:</span>
                      <span
                        className={`font-bold ${
                          currentMachine.healthIndex > 85
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : currentMachine.healthIndex > 65
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {currentMachine.healthIndex}%
                      </span>
                      <span className="text-zinc-500 ml-2">Run Hours:</span>
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {currentMachine.runtimeHours.toLocaleString()} h
                      </span>
                    </div>
                  </div>
                </div>

            {/* Dense Telemetry Sparklines Table */}
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    REAL-TIME SENSOR TELEMETRY BUS // {currentMachine.id} - {currentMachine.name}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">[{currentMachine.area}]</span>
                </div>
                <div className="text-[11px] font-mono text-zinc-500 flex items-center gap-2">
                  <span>SAMPLES: {currentMachine.telemetry.length} PT WINDOW</span>
                  <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping" />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/80 text-[10px] text-zinc-500 uppercase tracking-wider">
                      <th className="py-2 px-3">Channel ID</th>
                      <th className="py-2 px-3">Parameter</th>
                      <th className="py-2 px-3">Current Value</th>
                      <th className="py-2 px-3">Setpoint / Band</th>
                      <th className="py-2 px-3">Signal Trend (2m Sparkline)</th>
                      <th className="py-2 px-3">Status Indicator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {currentMachine.telemetry.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-400 font-mono text-xs">
                          Waiting for telemetry data from backend...
                        </td>
                      </tr>
                    ) : (
                      <>
                        {/* Channel 1: Distance */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-01.DIST</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Ultrasonic Distance</div>
                            <div className="text-[10px] text-zinc-400">Front-facing ultrasonic range sensor</div>
                          </td>
                          <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {currentLatestPoint.distance_cm}
                            <span className="text-zinc-400 text-xs ml-1 font-normal">cm</span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">Range: 2-400 cm</td>
                          <td className="py-2.5 px-3">
                            <SvgSparkline
                              data={currentMachine.telemetry.map((p: TelemetryPoint) => p.distance_cm)}
                              color={highlightMetrics.includes('distance_cm') ? '#d97706' : '#2563eb'}
                              height={28}
                              width={190}
                              fill
                              showMinMax
                              unit="cm"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            {highlightMetrics.includes('distance_cm') ? (
                              <span className="text-amber-700 dark:text-amber-400 font-bold text-[11px]">INVESTIGATING</span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold">NOMINAL</span>
                            )}
                          </td>
                        </tr>

                        {/* Channel 2: Current */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-02.CURR</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Motor Current</div>
                            <div className="text-[10px] text-zinc-400">DC motor current draw sensor</div>
                          </td>
                          <td className="py-2.5 px-3 text-sm font-bold">
                            <span
                              className={
                                currentLatestPoint.current_a > 5.0
                                  ? 'text-red-700 dark:text-red-400'
                                  : currentLatestPoint.current_a > 3.5
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-zinc-900 dark:text-zinc-100'
                              }
                            >
                              {currentLatestPoint.current_a}
                            </span>
                            <span className="text-zinc-400 text-xs ml-1 font-normal">A</span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                            Warn &gt; 3.5A | Crit &gt; 5.0A
                          </td>
                          <td className="py-2.5 px-3">
                            <SvgSparkline
                              data={currentMachine.telemetry.map((p: TelemetryPoint) => p.current_a)}
                              color={
                                highlightMetrics.includes('current_a')
                                  ? '#d97706'
                                  : currentLatestPoint.current_a > 5.0
                                  ? '#dc2626'
                                  : currentLatestPoint.current_a > 3.5
                                  ? '#d97706'
                                  : '#059669'
                              }
                              height={28}
                              width={190}
                              fill
                              showMinMax
                              unit="A"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            {highlightMetrics.includes('current_a') ? (
                              <span className="text-amber-700 dark:text-amber-400 font-bold text-[11px]">INVESTIGATING</span>
                            ) : currentLatestPoint.current_a > 5.0 ? (
                              <span className="text-red-700 dark:text-red-400 font-bold text-[11px]">OVERLOAD</span>
                            ) : currentLatestPoint.current_a > 3.5 ? (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold text-[11px]">ELEVATED</span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">NOMINAL</span>
                            )}
                          </td>
                        </tr>

                        {/* Channel 3: RPM */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-03.RPM</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Motor RPM</div>
                            <div className="text-[10px] text-zinc-400">Optical encoder speed feedback</div>
                          </td>
                          <td className="py-2.5 px-3 text-sm font-bold">
                            <span
                              className={
                                currentLatestPoint.rpm < 100
                                  ? 'text-red-700 dark:text-red-400'
                                  : currentLatestPoint.rpm < 500
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-zinc-900 dark:text-zinc-100'
                              }
                            >
                              {currentLatestPoint.rpm}
                            </span>
                            <span className="text-zinc-400 text-xs ml-1 font-normal">RPM</span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                            Warn &lt; 500 | Crit &lt; 100
                          </td>
                          <td className="py-2.5 px-3">
                            <SvgSparkline
                              data={currentMachine.telemetry.map((p: TelemetryPoint) => p.rpm)}
                              color={
                                highlightMetrics.includes('rpm')
                                  ? '#d97706'
                                  : currentLatestPoint.rpm < 100
                                  ? '#dc2626'
                                  : currentLatestPoint.rpm < 500
                                  ? '#d97706'
                                  : '#2563eb'
                              }
                              height={28}
                              width={190}
                              fill
                              showMinMax
                              unit="rpm"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            {highlightMetrics.includes('rpm') ? (
                              <span className="text-amber-700 dark:text-amber-400 font-bold text-[11px]">INVESTIGATING</span>
                            ) : currentLatestPoint.rpm < 100 ? (
                              <span className="text-red-700 dark:text-red-400 font-bold text-[11px]">STALL</span>
                            ) : currentLatestPoint.rpm < 500 ? (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold text-[11px]">LOW SPEED</span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">NOMINAL</span>
                            )}
                          </td>
                        </tr>

                        {/* Channel 4: Mode */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-04.MODE</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Operating Mode</div>
                            <div className="text-[10px] text-zinc-400">Motor control mode state</div>
                          </td>
                          <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {currentLatestPoint.mode}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">forward, idle, reverse</td>
                          <td className="py-2.5 px-3">
                            <div className="text-[10px] text-zinc-400 font-mono">State: {currentLatestPoint.mode.toUpperCase()}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold">ACTIVE</span>
                          </td>
                        </tr>

                        {/* Channel 5: PWM Command */}
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-05.PWM</td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">PWM Command</div>
                            <div className="text-[10px] text-zinc-400">Motor driver PWM signal (0-255)</div>
                          </td>
                          <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {currentLatestPoint.pwm_command}
                            <span className="text-zinc-400 text-xs ml-1 font-normal">/255</span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">Range: 0-255</td>
                          <td className="py-2.5 px-3">
                            <SvgSparkline
                              data={currentMachine.telemetry.map((p: TelemetryPoint) => p.pwm_command)}
                              color="#475569"
                              height={28}
                              width={190}
                              fill
                              showMinMax
                              unit=""
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold">COMMAND SENT</span>
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Subsystem Health Indicators */}
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                <span>Subsystem Health Indicators</span>
                <span className="text-[10px] font-mono text-zinc-500">DRIVEN BY BACKEND AI DIAGNOSTICS</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">Drivetrain Health</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">MONITORING</span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                    <div className="bg-emerald-600 h-full" style={{ width: '100%' }} />
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Status updated based on AI analysis results.
                  </div>
                </div>

                <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">Motor Assembly</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">MONITORING</span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                    <div className="bg-emerald-600 h-full" style={{ width: '100%' }} />
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Status updated based on AI analysis results.
                  </div>
                </div>

                <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">Ultrasonic Array</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">MONITORING</span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                    <div className="bg-emerald-600 h-full" style={{ width: '100%' }} />
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Status updated based on AI analysis results.
                  </div>
                </div>

                <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">Battery System</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">MONITORING</span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                    <div className="bg-emerald-600 h-full" style={{ width: '100%' }} />
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Status updated based on AI analysis results.
                  </div>
                </div>
              </div>
            </div>
          </>
            )}
          </section>
        )}

        {/* VIEW 2: AI DIAGNOSTICS & RCA DOSSIERS */}
        {activeTab === 'DIAGNOSTICS' && (
          <section className="space-y-4">
            {!deviceConnected ? (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center">
                <div className="max-w-md mx-auto">
                  <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2">
                    No Diagnostics Available
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
                    Connect a device to view AI-powered diagnostic findings from the backend ML reasoning layer.
                  </p>
                  <button
                    onClick={() => setShowDeviceDialog(true)}
                    className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm"
                  >
                    Connect Device
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
                  <div>
                    <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                      AI Diagnostics // Backend ML Reasoning Layer
                    </div>
                    <div className="text-xs text-zinc-500 font-mono">
                      Preliminary rule-based diagnoses and final LLM-based diagnoses from backend
                    </div>
                  </div>

                  <button
                    onClick={triggerManualDiagnostics}
                    disabled={aiAnalysisRunning}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 flex items-center gap-1.5"
                  >
                    Run New Inference Cycle
                  </button>
                </div>

                <div className="space-y-4">
                  {findings.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400 font-mono text-xs">
                      No diagnostic findings yet. Wait for backend to detect anomalies or trigger manual analysis.
                    </div>
                  ) : (
                    findings.map((item: DiagnosticFinding) => (
                      <div
                        key={item.id}
                        className="border border-zinc-300 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/60 p-4"
                      >
                        <div className="flex flex-wrap justify-between items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2.5 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-0.5">
                              {item.id}
                            </span>
                            <span className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                              TARGET: {item.machineId}
                            </span>
                            <span className="text-zinc-400 font-mono text-xs">| {item.timestamp}</span>
                            {item.stage && (
                              <span className={`font-mono text-[10px] px-1.5 py-0.5 ${
                                item.stage === 'preliminary'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                              }`}>
                                {item.stage.toUpperCase()}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-zinc-500">CONFIDENCE:</span>
                            <span className="font-bold text-blue-700 dark:text-blue-400">
                              {Math.round(item.confidence * 100)}%
                            </span>
                            <span className="text-zinc-500 ml-2">SEVERITY:</span>
                            <span
                              className={`font-bold px-1.5 py-0.5 text-[10px] ${
                                item.severity === 'HIGH'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                              }`}
                            >
                              {item.severity}
                            </span>
                          </div>
                        </div>

                        <h3 className="text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2">
                          {item.title}
                        </h3>

                        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 mb-3">
                          <div className="text-[10px] font-mono font-bold text-zinc-400 uppercase mb-1">
                            DETERMINED ROOT CAUSE MECHANISM:
                          </div>
                          <p className="text-xs text-zinc-700 dark:text-zinc-300 font-sans leading-relaxed">
                            {item.rootCauseHypothesis}
                          </p>
                        </div>

                        <div className="mb-3">
                          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase mb-1.5">
                            CROSS-MODAL EVIDENCE CORROBORATION:
                          </div>
                          <ul className="space-y-1">
                            {item.evidencePoints.map((ev: string, idx: number) => (
                              <li
                                key={idx}
                                className="text-xs font-mono text-zinc-600 dark:text-zinc-400 flex items-start gap-2"
                              >
                                <span className="text-blue-600 dark:text-blue-400 font-bold">&gt;&gt;</span>
                                <span>{ev}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-500 p-2.5 mb-3 text-xs font-mono">
                          <span className="font-bold text-amber-800 dark:text-amber-300 mr-2">RECOMMENDED ACTION:</span>
                          <span className="text-zinc-800 dark:text-zinc-200">{item.recommendedAction}</span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs font-mono">
                          <span className="text-zinc-500">
                            STATUS: <strong className="text-zinc-800 dark:text-zinc-200">{item.status.replace(/_/g, ' ')}</strong>
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setFindings((prev: readonly DiagnosticFinding[]) =>
                                  prev.map((f: DiagnosticFinding) =>
                                    f.id === item.id ? { ...f, status: 'TRIAGED' } : f
                                  )
                                );
                              }}
                              className="px-2.5 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-[11px]"
                            >
                              Acknowledge Triage
                            </button>
                            <button
                              onClick={() => {
                                alert(
                                  `[CMMS] Dispatching Priority Work Order to SAP Plant Maintenance for ${item.machineId}`
                                );
                                setFindings((prev: readonly DiagnosticFinding[]) =>
                                  prev.map((f: DiagnosticFinding) =>
                                    f.id === item.id ? { ...f, status: 'DISPATCHED' } : f
                                  )
                                );
                              }}
                              className="px-2.5 py-1 bg-zinc-900 hover:bg-black text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 text-[11px] font-semibold border border-transparent"
                            >
                              Dispatch Work Order
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* VIEW 3: SCADA EVENT JOURNAL (LOGS) */}
        {activeTab === 'LOGS' && (
          <section className="space-y-4">
            {!deviceConnected ? (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center">
                <div className="max-w-md mx-auto">
                  <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2">
                    No Event Logs Available
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
                    Connect a device to view real-time event logs and investigation steps from the backend.
                  </p>
                  <button
                    onClick={() => setShowDeviceDialog(true)}
                    className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm"
                  >
                    Connect Device
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
              <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-zinc-600 dark:text-zinc-400">Filter Severity:</span>
                  <div className="flex gap-1">
                    {(['ALL', 'CRIT', 'WARN'] as const).map((sev: LogFilterSeverity) => (
                      <button
                        key={sev}
                        onClick={() => setActiveFilterSeverity(sev)}
                        className={`px-2 py-0.5 text-[11px] border ${
                          activeFilterSeverity === sev
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 border-transparent font-bold'
                            : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Search Logs:</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                    placeholder="e.g. thermocouple, BPFO, 104..."
                    className="px-2 py-1 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-none w-56 focus:outline-none focus:border-blue-600"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-zinc-400 hover:text-zinc-600 text-xs">
                      CLEAR
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-2 px-3 w-32">Timestamp</th>
                      <th className="py-2 px-3 w-20">Severity</th>
                      <th className="py-2 px-3 w-28">MACHINE</th>
                      <th className="py-2 px-3 w-36">SUBSYSTEM</th>
                      <th className="py-2 px-3">Event Message</th>
                      <th className="py-2 px-3 w-48">Metric Trigger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-400 font-mono text-xs">
                          No log entries match the filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log: LogEntry) => (
                        <tr
                          key={log.id}
                          className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${
                            log.level === 'CRIT'
                              ? 'bg-red-50/30 dark:bg-red-950/15'
                              : log.level === 'WARN'
                              ? 'bg-amber-50/20 dark:bg-amber-950/10'
                              : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-zinc-500 text-[11px] whitespace-nowrap">{log.timestamp}</td>
                          <td className="py-2 px-3">
                            <LogLevelBadge level={log.level} />
                          </td>
                          <td className="py-2 px-3 font-semibold text-zinc-800 dark:text-zinc-200">{log.machineId}</td>
                          <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">{log.subsystem.replace(/_/g, ' ')}</td>
                          <td className="py-2 px-3 text-zinc-900 dark:text-zinc-100">{log.message}</td>
                          <td className="py-2 px-3 text-[11px] text-zinc-500 font-semibold">
                            {log.metricTrigger || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[10px] font-mono text-zinc-500 flex justify-between">
                <span>SHOWING {filteredLogs.length} OF {logs.length} BUFFERED SCADA RECORDS</span>
                <span>Ring Buffer: Nominal (No Overflow)</span>
              </div>
            </div>
            )}
          </section>
        )}
      </main>

      {/* 3. IO / WebSocket Integration Modal */}
      <IoConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        wsEndpoint={wsEndpoint}
        setWsEndpoint={setWsEndpoint}
        streamActive={streamActive}
        isConnected={isConnected}
      />

      {/* 4. Device Connection Dialog */}
      <DeviceConnectionDialog
        isOpen={showDeviceDialog}
        onClose={() => setShowDeviceDialog(false)}
        onConnect={handleDeviceConnect}
        deviceConnected={deviceConnected}
      />

      {/* 4. RC Car Monitoring System Footer */}
      <footer className="border-t border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-[10px] font-mono text-zinc-500 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-3">
          <span>MachSight RC Car Monitor // Test Track Zone A</span>
          <span>PROTOCOL: WebSocket / FastAPI</span>
        </div>
        <div className="flex items-center gap-4">
          <span>UTC Time: {new Date().toISOString().replace('T', ' ').substring(0, 19)}</span>
          <span
            className={`${isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'} font-semibold`}
          >
            {isConnected ? 'WebSocket Connected' : 'WebSocket Disconnected'}
          </span>
        </div>
      </footer>
    </div>
  );
}
