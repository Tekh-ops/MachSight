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
export type DashboardTab = 'LANDING' | 'OVERVIEW' | 'INSIGHTS' | 'DIAGNOSTICS' | 'LOGS';
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
}

export interface DefectFrequencyDefinition {
  readonly faultType: string;
  readonly acronym: string;
  readonly orderMultiple: string;
  readonly frequencyHz: number;
  readonly measuredEnergyMmS: number;
  readonly thresholdMmS: number;
  readonly statusTag: 'ALERT_HIGH' | 'NOMINAL';
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
}

export interface IoConfigModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly wsEndpoint: string;
  readonly setWsEndpoint: (endpoint: string) => void;
  readonly streamActive: boolean;
  readonly isConnected: boolean;
}

// ============================================================================
// 2. MOCK DATA INITIALIZATION & UTILITIES
// ============================================================================

function generateInitialSeries(
  baseDistance: number,
  baseCurrent: number,
  baseRpm: number,
  baseMode: string,
  basePwm: number
): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  const now = Date.now();
  for (let i = 300; i >= 0; i--) {
    const t = new Date(now - i * 100);
    const timeStr = t.toTimeString().split(' ')[0] ?? '00:00:00';
    points.push({
      time: timeStr,
      distance_cm: +(baseDistance + (Math.random() - 0.5) * 5).toFixed(1),
      current_a: +(baseCurrent + (Math.random() - 0.5) * 0.5).toFixed(2),
      rpm: Math.round(baseRpm + (Math.random() - 0.5) * 50),
      mode: baseMode,
      pwm_command: Math.round(basePwm + (Math.random() - 0.5) * 10),
    });
  }
  return points;
}

const INITIAL_MACHINES: readonly MachineUnit[] = [
  {
    id: 'RC-01',
    tag: 'CAR-PROTO-01',
    name: 'RC Car Test Unit Alpha',
    area: 'Test Track Zone A',
    status: 'WARNING',
    healthIndex: 78.4,
    runtimeHours: 142.2,
    lastAnomaly: 'Elevated current draw with reduced RPM ratio',
    activeAlertCount: 2,
    telemetry: generateInitialSeries(85.0, 3.8, 1200, 'forward', 200),
  },
  {
    id: 'RC-02',
    tag: 'CAR-PROTO-02',
    name: 'RC Car Test Unit Beta',
    area: 'Test Track Zone B',
    status: 'NOMINAL',
    healthIndex: 96.8,
    runtimeHours: 89.5,
    lastAnomaly: 'None (Self-test passed 04:00 UTC)',
    activeAlertCount: 0,
    telemetry: generateInitialSeries(120.0, 2.1, 1800, 'forward', 180),
  },
];

const INITIAL_LOGS: readonly LogEntry[] = [
  {
    id: 'log-1001',
    timestamp: '12:26:45.102',
    machineId: 'RC-01',
    level: 'WARN',
    subsystem: 'DRIVETRAIN',
    message: 'Current/RPM ratio elevated above baseline threshold.',
    metricTrigger: 'CURRENT_RPM_RATIO=1.26 > BASE',
  },
  {
    id: 'log-1002',
    timestamp: '12:26:30.820',
    machineId: 'RC-01',
    level: 'INFO',
    subsystem: 'ULTRASONIC_ARRAY',
    message: 'Distance sensor reading within nominal range.',
    metricTrigger: 'DISTANCE_CM=85.0',
  },
  {
    id: 'log-1003',
    timestamp: '12:25:58.411',
    machineId: 'RC-02',
    level: 'DEBUG',
    subsystem: 'MOTOR_ASSEMBLY',
    message: 'Motor PWM command response within expected latency.',
    metricTrigger: 'PWM_LATENCY=12ms',
  },
  {
    id: 'log-1004',
    timestamp: '12:24:12.004',
    machineId: 'RC-02',
    level: 'INFO',
    subsystem: 'POWER_TRAIN',
    message: 'Battery voltage nominal, discharge rate stable.',
  },
];

const INITIAL_FINDINGS: readonly DiagnosticFinding[] = [
  {
    id: 'DIAG-8821',
    timestamp: '2026-09-26 12:15 UTC',
    machineId: 'EXT-104',
    severity: 'HIGH',
    confidence: 0.94,
    title: 'Severe Hydraulic Cavitation & Barrel Zone 3 Thermal Runaway',
    rootCauseHypothesis:
      'Proportional throttle valve spool sticking due to hydraulic fluid thermal breakdown (viscosity degraded to 38.1 cSt). High fluid friction generating localized barrel shear heating.',
    evidencePoints: [
      'Acoustic emission frequency spikes at 28.4 kHz (bubble collapse signature)',
      'Hydraulic pressure fluctuation variance increased 410% in last 120 mins',
      'Infrared thermal zone 3 steady rise: dT/dt = +0.42°C/min under static feed rate',
      'Optical log: visual discoloration along extruder nozzle collar detected by cam #1',
    ],
    recommendedAction:
      'Immediate shift to standby idle. Inspect proportional valve pilot filter. Draw oil sample for Karl Fischer titration & viscosity check. Lock out automated feed screw.',
    status: 'PENDING_ACK',
  },
  {
    id: 'DIAG-8819',
    timestamp: '2026-09-26 11:42 UTC',
    machineId: 'CNC-501',
    severity: 'MEDIUM',
    confidence: 0.87,
    title: 'Spindle Bearing Outer Raceway Spalling (BPFO Signature)',
    rootCauseHypothesis:
      'Micro-spalling on spindle front roller assembly outer ring due to dynamic unbalance during deep pocket milling roughing operations.',
    evidencePoints: [
      'Vibration RMS reached 4.41 mm/s exceeding ISO 10816-3 Class II Alert limit (3.5 mm/s)',
      'Kurtosis metric elevated to 5.2 (Gaussian baseline = 3.0)',
      'Envelope spectral analysis identifies clear peaks at 1x, 2x, 3x BPFO (238 Hz, 476 Hz)',
    ],
    recommendedAction:
      'Limit spindle RPM to max 7,500 rpm. Schedule off-shift replacement of front bearing cartridge within 48 operating hours. Re-torque tool clamping drawbar.',
    status: 'TRIAGED',
  },
];

const DEFECT_FREQUENCIES: readonly DefectFrequencyDefinition[] = [
  {
    faultType: 'Ball Pass Frequency Outer Race',
    acronym: 'BPFO',
    orderMultiple: '3.58 x',
    frequencyHz: 86.5,
    measuredEnergyMmS: 0.84,
    thresholdMmS: 0.4,
    statusTag: 'ALERT_HIGH',
  },
  {
    faultType: 'Ball Pass Frequency Inner Race',
    acronym: 'BPFI',
    orderMultiple: '5.42 x',
    frequencyHz: 130.8,
    measuredEnergyMmS: 0.12,
    thresholdMmS: 0.4,
    statusTag: 'NOMINAL',
  },
  {
    faultType: 'Ball Spin Frequency',
    acronym: 'BSF',
    orderMultiple: '2.31 x',
    frequencyHz: 55.7,
    measuredEnergyMmS: 0.08,
    thresholdMmS: 0.35,
    statusTag: 'NOMINAL',
  },
  {
    faultType: 'Fundamental Train Frequency (Cage)',
    acronym: 'FTF',
    orderMultiple: '0.41 x',
    frequencyHz: 9.9,
    measuredEnergyMmS: 0.04,
    thresholdMmS: 0.25,
    statusTag: 'NOMINAL',
  },
];

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
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">Alerts Active:</span>
              <span className="text-red-700 dark:text-red-400 font-bold">{activeAlertCount}</span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">FACILITY:</span>
              <span className="text-zinc-700 dark:text-zinc-300">Test Track Zone A</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setStreamActive(!streamActive)}
            title="Pause or resume live sensor packet ingestion loop"
            className={`px-2 py-1 font-mono text-[11px] rounded border transition-colors flex items-center gap-1.5 ${
              streamActive
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'border-zinc-400 bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${streamActive ? 'bg-emerald-600 animate-ping' : 'bg-zinc-400'}`} />
            {streamActive ? 'Stream Active' : 'Stream Paused'}
          </button>

          <button
            onClick={triggerManualDiagnostics}
            disabled={aiAnalysisRunning}
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
            { id: 'INSIGHTS', label: '[2] Spectrograms', tag: 'FFT' },
            { id: 'DIAGNOSTICS', label: '[3] AI Diagnostics' },
            { id: 'LOGS', label: '[4] Event Logs' },
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

// ============================================================================
// 4. MAIN DASHBOARD CONTAINER COMPONENT
// ============================================================================

export default function IndustrialDoctorApp(): ReactElement {
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>('OVERVIEW');
  const [machines, setMachines] = useState<readonly MachineUnit[]>(INITIAL_MACHINES);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('RC-01');
  const [logs, setLogs] = useState<readonly LogEntry[]>(INITIAL_LOGS);
  const [findings, setFindings] = useState<readonly DiagnosticFinding[]>(INITIAL_FINDINGS);
  const [streamActive, setStreamActive] = useState<boolean>(true);
  const [packetCount, setPacketCount] = useState<number>(0);
  const [activeFilterSeverity, setActiveFilterSeverity] = useState<LogFilterSeverity>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aiAnalysisRunning, setAiAnalysisRunning] = useState<boolean>(false);
  const [wsEndpoint, setWsEndpoint] = useState<string>('ws://localhost:8000/ws');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
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

  // WebSocket connection with exponential backoff
  useEffect(() => {
    if (!streamActive) {
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

            // Rate limiting: max 10Hz UI updates
            const now = Date.now();
            if (now - lastUpdateTimeRef.current < 100) {
              return;
            }
            lastUpdateTimeRef.current = now;

            // Handle different event types
            if (data.type === 'processed' && data.data) {
              // Update telemetry from processed event
              // Note: processed events don't contain raw telemetry, they contain analysis results
              // We'll need to get raw telemetry from the backend's REST API or store it locally
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

                if (data.type === 'diagnosis') {
                  setCurrentDiagnosis(parsedPayload);
                  setAiAnalysisRunning(false);

                  // Add to findings if it's a final diagnosis
                  if (parsedPayload.stage === 'final' && parsedPayload.diagnosis && parsedPayload.diagnosis !== 'inconclusive') {
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
          if (reconnectAttempts < maxReconnectAttempts && streamActive) {
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
  }, [wsEndpoint, streamActive, selectedMachineId]);

  // Mock telemetry update (since processed events don't contain raw data)
  // In production, you'd fetch raw telemetry from REST API or have it sent via WebSocket
  useEffect(() => {
    if (!streamActive || !isConnected) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';

      setMachines((prevMachines) =>
        prevMachines.map((m) => {
          const lastPoint = m.telemetry[m.telemetry.length - 1]!;
          const jitterMult = m.status === 'CRITICAL' ? 2.5 : m.status === 'WARNING' ? 1.4 : 0.6;

          const distanceNoise = (Math.random() - 0.5) * 5 * jitterMult;
          const currentNoise = (Math.random() - 0.5) * 0.3 * jitterMult;
          const rpmNoise = (Math.random() - 0.5) * 30 * jitterMult;
          const pwmNoise = (Math.random() - 0.5) * 5 * jitterMult;

          const newPoint: TelemetryPoint = {
            time: timeStr,
            distance_cm: Math.max(0, +(lastPoint.distance_cm + distanceNoise).toFixed(1)),
            current_a: Math.max(0, +(lastPoint.current_a + currentNoise).toFixed(2)),
            rpm: Math.max(0, Math.round(lastPoint.rpm + rpmNoise)),
            mode: lastPoint.mode,
            pwm_command: Math.max(0, Math.min(255, Math.round(lastPoint.pwm_command + pwmNoise))),
          };

          // Keep buffer at ~300 points
          const nextTelemetry = [...m.telemetry.slice(-299), newPoint];

          let newStatus = m.status;
          if (newPoint.current_a > 5.0 || newPoint.rpm < 100) {
            newStatus = 'CRITICAL';
          } else if (newPoint.current_a > 3.5 || newPoint.rpm < 500) {
            newStatus = 'WARNING';
          } else {
            newStatus = 'NOMINAL';
          }

          return {
            ...m,
            status: newStatus,
            telemetry: nextTelemetry,
          };
        })
      );
    }, 100); // 10Hz max update rate

    return () => clearInterval(interval);
  }, [streamActive, isConnected]);

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

  // Mock Streaming Loop (for logs only - telemetry comes from WebSocket)
  useEffect(() => {
    if (!streamActive) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timestampWithMs = `${timeStr}.${ms}`;

      if (Math.random() > 0.65) {
        const randomMachine = machines[Math.floor(Math.random() * machines.length)]!;
        const possibleLogs: {
          level: LogSeverity;
          sub: SubsystemType;
          msg: string;
          trigger?: string;
        }[] = [
          { level: 'INFO', sub: 'THERMAL_LOOP', msg: 'Motor temperature within normal operating range.' },
          { level: 'DEBUG', sub: 'POWER_TRAIN', msg: 'Motor encoder sync confirmed.' },
          {
            level: 'WARN',
            sub: 'DRIVETRAIN',
            msg: 'Current/RPM ratio elevated above baseline.',
            trigger: 'CURRENT_RPM_RATIO=1.26',
          },
          {
            level: 'INFO',
            sub: 'MOTOR_ASSEMBLY',
            msg: 'PWM command response nominal.',
          },
          {
            level: 'CRIT',
            sub: 'ULTRASONIC_ARRAY',
            msg: 'Distance sensor reading out of range.',
            trigger: 'DISTANCE_CM=450cm',
          },
          {
            level: 'DEBUG',
            sub: 'VISION_INSPECT',
            msg: 'Visual inspection feed nominal.',
          },
        ];
        const picked = possibleLogs[Math.floor(Math.random() * possibleLogs.length)]!;

        const newLogEntry: LogEntry = {
          id: `log-${Date.now()}-${Math.floor(Math.random() * 999)}`,
          timestamp: timestampWithMs,
          machineId: randomMachine.id,
          level: picked.level,
          subsystem: picked.sub,
          message: picked.msg,
          metricTrigger: picked.trigger,
        };

        setLogs((prev: readonly LogEntry[]) => [newLogEntry, ...prev.slice(0, 79)]);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [streamActive, machines]);

  // Trigger AI Audit Simulation (placeholder - real diagnosis comes from WebSocket)
  const triggerManualDiagnostics = (): void => {
    setAiAnalysisRunning(true);
    // In real implementation, this would send a request to backend to trigger investigation
    // For now, we'll simulate after a delay
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
      />

      {/* 2. Main Dashboard Content Views */}
      <main className="p-4 max-w-[1920px] mx-auto space-y-4">
        {/* VIEW 0: SYSTEM LANDING GATEWAY */}
        {activeTab === 'LANDING' && (
          <section className="space-y-4">
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 rounded-none shadow-sm">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
                <div>
                  <div className="font-mono text-xs text-blue-700 dark:text-blue-400 font-semibold mb-1">
                    System Overview // Industrial Diagnostic Agent
                  </div>
                  <h1 className="text-2xl font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-100">
                    Industrial Machine Health & Predictive Diagnostic Engine
                  </h1>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 font-sans mt-1 max-w-3xl leading-relaxed">
                    Edge-deployed autonomous inference platform monitoring high-duty rotating industrial machinery.
                    Continuous multi-modal telemetry correlation combining accelerometer vibration metrics,
                    thermocouple heat loops, hydraulic transducer profiles, and visual quality audit streams.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('OVERVIEW')}
                    className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm"
                  >
                    Enter Dashboard &rarr;
                  </button>
                  <button
                    onClick={() => setActiveTab('DIAGNOSTICS')}
                    className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs border border-zinc-300 dark:border-zinc-700"
                  >
                    Active RCA Findings
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-5">
                <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Fleet Online</div>
                  <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">4 / 4</div>
                  <div className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">100% QUORUM</div>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">System Health (Mean)</div>
                  <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">79.7%</div>
                  <div className="text-[10px] font-mono text-amber-700 dark:text-amber-400 mt-0.5">-3.2% 24h delta</div>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Active Trips / Alarms</div>
                  <div className="text-xl font-mono font-bold text-red-700 dark:text-red-400 mt-1">1 CRIT / 1 WARN</div>
                  <div className="text-[10px] font-mono text-zinc-500 mt-0.5">ISO 10816 CLASS II</div>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Inference Latency</div>
                  <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">18.4 ms</div>
                  <div className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">Edge TPU Online</div>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Total Runtime Hours</div>
                  <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">42,401.1</div>
                  <div className="text-[10px] font-mono text-zinc-500 mt-0.5">MTBF 4,200h</div>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Protocol Gateway</div>
                  <div className="text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1">OPC-UA / MQTT</div>
                  <div className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">TLS 1.3 SECURE</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3">
                  <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    Module 01: Sensor Telemetry Bus
                  </span>
                  <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">STATUS: SYNCED</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
                  High-frequency time-series buffer aggregating multi-axial accelerometers (Vib RMS), thermistors
                  (Bearing °C), hydraulic load cells (bar), acoustic microphones (dB), and kW electrical power draw.
                </p>
                <div className="bg-zinc-100 dark:bg-zinc-950 p-2 border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1">
                  <div>- Ingestion frequency: 2,500ms cycle</div>
                  <div>- Interpolation algorithm: Akima spline</div>
                  <div>- Buffer depth: 10,000 pts per machine</div>
                </div>
              </div>

              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3">
                  <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    Module 02: AI Anomaly & RCA Agent
                  </span>
                  <span className="font-mono text-[10px] text-blue-700 dark:text-blue-400">ENGINE: V4.1-ENG</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
                  Autonomous diagnostic reasoning agent mapping physical vibration spectra (BPFO, BPFI, BSF, FTF bearing
                  frequencies) with thermal runaway dynamics and oil chemical degradation profiles.
                </p>
                <div className="bg-zinc-100 dark:bg-zinc-950 p-2 border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1">
                  <div>- Bayesian fault isolation logic</div>
                  <div>- Automated Work Order (CMMS) dispatch payload</div>
                  <div>- Cross-subsystem correlation matrix</div>
                </div>
              </div>

              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3">
                  <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    Module 03: Computer Vision Inspection
                  </span>
                  <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">STREAMS: 4 CAMERAS</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
                  Synchronous visual inspection stream detecting tool wear, surface spalling, lubricant discoloration,
                  and hydraulic leak pooling via embedded edge camera units.
                </p>
                <div className="bg-zinc-100 dark:bg-zinc-950 p-2 border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1">
                  <div>- In-line optical surface roughness (Ra)</div>
                  <div>- FLIR thermal camera thresholding</div>
                  <div>- 60 fps tool path validation</div>
                </div>
              </div>
            </div>

            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                Active System Units // Select Unit For Inspection
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {machines.map((m: MachineUnit) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      setSelectedMachineId(m.id);
                      setActiveTab('OVERVIEW');
                    }}
                    className={`p-3 border cursor-pointer transition-colors ${
                      selectedMachineId === m.id
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">{m.id}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">{m.name}</div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-1">{m.area}</div>
                    <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center text-[10px] font-mono">
                      <span>HEALTH: {m.healthIndex}%</span>
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">View Matrix &rarr;</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* VIEW 1: TELEMETRY MATRIX (OVERVIEW) */}
        {activeTab === 'OVERVIEW' && (
          <div className="space-y-4">
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
                  <span>SAMPLES: 25 PT WINDOW</span>
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
                  </tbody>
                </table>
              </div>
            </div>

            {/* Visual Stream & Subsystem Wear Profiles */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-2 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  <span>Optical Inspection Feed // Cam 02</span>
                  <span className="text-[10px] font-normal text-emerald-700 dark:text-emerald-400 font-mono">
                    60 FPS // 1080p
                  </span>
                </div>

                <div className="relative bg-zinc-950 border border-zinc-700 aspect-video flex flex-col justify-between p-3 font-mono text-white overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-15 pointer-events-none"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  />

                  <div className="relative z-10 flex justify-between items-center text-[10px]">
                    <span className="text-zinc-400">Frame: #449102</span>
                    <span className="bg-red-600 px-1 text-white font-bold animate-pulse text-[9px]">Live Rec</span>
                  </div>

                  <div className="relative z-10 my-auto flex flex-col items-center justify-center">
                    <div className={`w-28 h-20 border-2 ${anomalyDetected ? 'border-red-500 bg-red-500/20' : 'border-amber-500 bg-amber-500/10'} flex flex-col justify-between p-1 ${anomalyDetected ? 'animate-pulse' : ''}`}>
                      <span className={`text-[9px] ${anomalyDetected ? 'text-red-400' : 'text-amber-400'} bg-black/70 px-1 self-start`}>
                        {anomalyDetected ? 'ANOMALY DETECTED' : 'Defect Detection Region'}
                      </span>
                      <span className={`text-[8px] ${anomalyDetected ? 'text-red-300' : 'text-amber-300'} self-end font-mono`}>
                        CONF: {anomalyDetected ? (currentDiagnosis?.confidence ? `${(currentDiagnosis.confidence * 100).toFixed(1)}%` : 'HIGH') : '91.2%'}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-300 mt-2 bg-black/75 px-1.5 py-0.5">
                      TARGET: {anomalyDetected && currentDiagnosis?.diagnosis ? currentDiagnosis.diagnosis.substring(0, 30) + '...' : 'RC Car Front Chassis'}
                    </span>
                  </div>

                  <div className="relative z-10 flex justify-between text-[9px] text-zinc-400 border-t border-zinc-800 pt-1">
                    <span>Exposure: 1/1200s</span>
                    <span>Gain: 2.4dB</span>
                    <span>Surface Roughness (Ra): 0.82μm (PASS)</span>
                  </div>
                </div>

                <div className="mt-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 flex justify-between">
                  <span>Visual Log: No macro-cracking or lubrication breach detected.</span>
                </div>
              </div>

              <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-sm lg:col-span-2">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  <span>Subsystem DEGRADATION INDICES & WEAR PROFILE</span>
                  <span className="text-[10px] font-mono text-zinc-500">STANDARDS: ISO 13374 / VDI 3832</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Drivetrain Health</span>
                      <span className="text-amber-700 dark:text-amber-400 font-bold">WEAR: 24%</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-amber-600 h-full" style={{ width: '24%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      RUL (Remaining Useful Life): ~480 operating cycles. Gear mesh wear tracked.
                    </div>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Motor Assembly</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                        {currentLatestPoint.current_a < 3.5 ? 'NOMINAL' : 'ELEVATED'}
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-emerald-600 h-full" style={{ width: currentLatestPoint.current_a < 3.5 ? '88%' : '65%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Current draw within operational parameters. Thermal efficiency nominal.
                    </div>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Ultrasonic Array</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">96% ACCURACY</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-emerald-600 h-full" style={{ width: '96%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Distance sensor readings stable. Signal-to-noise ratio within specification.
                    </div>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Battery System</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">&gt; 85% CAPACITY</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-emerald-600 h-full" style={{ width: '92%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Discharge rate stable. Cell voltage balance within tolerance.
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-zinc-500">Command Override:</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => alert(`[RC CONTROL] Emergency stop dispatched to ${currentMachine.id}`)}
                      className="px-2 py-1 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-none text-[11px]"
                    >
                      Emergency Stop
                    </button>
                    <button
                      onClick={() => alert(`[RC CONTROL] Calibrate sensors for ${currentMachine.id}`)}
                      className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded-none text-[11px]"
                    >
                      Calibrate Sensors
                    </button>
                    <button
                      onClick={triggerManualDiagnostics}
                      className="px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white border border-blue-900 rounded-none text-[11px] font-semibold"
                    >
                      Analyze Anomalies
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: INSIGHTS & SPECTROGRAMS (FFT HARMONICS) */}
        {activeTab === 'INSIGHTS' && (
          <div className="space-y-4">
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    SPECTRAL FREQUENCY DECOMPOSITION (FFT) & HARMONIC TRACKING
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    MACHINE: {currentMachine.id} // BEARING_TYPE: SKF 6208 DEEP GROOVE BALL BEARING
                  </div>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-zinc-400">RESOLUTION:</span>
                  <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold border border-zinc-300 dark:border-zinc-700">
                    0.25 Hz / BIN
                  </span>
                  <span className="text-zinc-400">SAMPLING:</span>
                  <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold border border-zinc-300 dark:border-zinc-700">
                    25.6 kHz
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto mb-4">
                <table className="w-full text-left text-xs font-mono border border-zinc-200 dark:border-zinc-800">
                  <thead className="bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Fault Type</th>
                      <th className="py-2 px-3">ACRONYM</th>
                      <th className="py-2 px-3">Order (Multiple)</th>
                      <th className="py-2 px-3">Calculated Frequency</th>
                      <th className="py-2 px-3">Measured Energy</th>
                      <th className="py-2 px-3">Threshold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                    {DEFECT_FREQUENCIES.map((freq: DefectFrequencyDefinition) => (
                      <tr key={freq.acronym}>
                        <td className="py-2 px-3 font-semibold text-zinc-800 dark:text-zinc-200">{freq.faultType}</td>
                        <td
                          className={`py-2 px-3 font-bold ${
                            freq.statusTag === 'ALERT_HIGH'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-600 dark:text-zinc-400'
                          }`}
                        >
                          {freq.acronym}
                        </td>
                        <td className="py-2 px-3">{freq.orderMultiple}</td>
                        <td className="py-2 px-3 font-mono font-bold">{freq.frequencyHz} Hz</td>
                        <td
                          className={`py-2 px-3 font-bold ${
                            freq.statusTag === 'ALERT_HIGH'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {freq.measuredEnergyMmS.toFixed(2)} mm/s
                        </td>
                        <td className="py-2 px-3 text-zinc-500">
                          {freq.thresholdMmS.toFixed(2)} mm/s ({freq.statusTag})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Simulated SVG FFT Spectrum Graph */}
              <div className="border border-zinc-300 dark:border-zinc-800 bg-zinc-950 p-4 text-white">
                <div className="flex justify-between items-center text-[11px] font-mono text-zinc-400 mb-2">
                  <span>VELOCITY SPECTRUM [0 Hz to 500 Hz]</span>
                  <span className="text-amber-400 font-bold">Harmonic Match: 1x & 2x BPFO Confirmed</span>
                </div>

                <div className="w-full h-48 relative flex items-end">
                  <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 200">
                    <line x1="0" y1="50" x2="1000" y2="50" stroke="#3f3f46" strokeDasharray="3 3" strokeWidth="1" />
                    <line x1="0" y1="100" x2="1000" y2="100" stroke="#3f3f46" strokeDasharray="3 3" strokeWidth="1" />
                    <line x1="0" y1="150" x2="1000" y2="150" stroke="#3f3f46" strokeDasharray="3 3" strokeWidth="1" />

                    <line x1="0" y1="80" x2="1000" y2="80" stroke="#dc2626" strokeDasharray="4 2" strokeWidth="1.5" />
                    <text x="10" y="74" fill="#dc2626" fontSize="10" fontFamily="monospace">
                      ALERT LIMIT = 0.40 mm/s
                    </text>

                    <polyline
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="1.5"
                      points="
                        0,195 20,192 40,194 50,140 55,190 70,193 100,194 
                        173,60 178,193 200,194 250,190 300,194 
                        346,110 350,192 400,193 500,195 600,194 700,195 800,194 900,195 1000,195
                      "
                    />

                    <circle cx="173" cy="60" r="4" fill="#d97706" />
                    <text x="180" y="55" fill="#f59e0b" fontSize="11" fontFamily="monospace" fontWeight="bold">
                      BPFO (1X) 86.5 Hz [0.84 mm/s]
                    </text>

                    <circle cx="346" cy="110" r="4" fill="#d97706" />
                    <text x="355" y="108" fill="#f59e0b" fontSize="10" fontFamily="monospace">
                      BPFO (2X) 173.0 Hz
                    </text>

                    <circle cx="50" cy="140" r="3" fill="#059669" />
                    <text x="56" y="136" fill="#10b981" fontSize="10" fontFamily="monospace">
                      1X RPM (24.2 Hz)
                    </text>
                  </svg>
                </div>

                <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 border-t border-zinc-800 pt-2 mt-1">
                  <span>0 Hz</span>
                  <span>100 Hz</span>
                  <span>200 Hz</span>
                  <span>300 Hz</span>
                  <span>400 Hz</span>
                  <span>500 Hz</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: AI DIAGNOSTICS & RCA DOSSIERS */}
        {activeTab === 'DIAGNOSTICS' && (
          <div className="space-y-4">
            <div className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
                <div>
                  <div className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    AI Incident Dossiers // Root Cause Synthesis
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    Reasoning Matrix Grounded in SCADA Logs & Telemetry
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
                {findings.map((item: DiagnosticFinding) => (
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
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: SCADA EVENT JOURNAL (LOGS) */}
        {activeTab === 'LOGS' && (
          <div className="space-y-4">
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
          </div>
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

      {/* 4. RC Car Monitoring System Footer */}
      <footer className="border-t border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-[10px] font-mono text-zinc-500 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-3">
          <span>MachSight RC Car Monitor // Test Track Zone A</span>
          <span>PROTOCOL: WebSocket / FastAPI</span>
        </div>
        <div className="flex items-center gap-4">
          <span>UTC Time: {new Date().toISOString().replace('T', ' ').substring(0, 19)}</span>
          <span className={isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'} font-semibold>
            {isConnected ? 'WebSocket Connected' : 'WebSocket Disconnected'}
          </span>
        </div>
      </footer>
    </div>
  );
}
