import React, { useState, useEffect, useMemo, type ReactElement } from 'react';

// ============================================================================
// 1. TYPE DEFINITIONS & DOMAIN SCHEMAS
// ============================================================================

export type OperationalStatus = 'NOMINAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
export type DiagnosticSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type DiagnosticStatus = 'PENDING_ACK' | 'TRIAGED' | 'DISPATCHED' | 'RESOLVED';
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'CRIT';
export type SubsystemType =
  | 'POWERTRAIN'
  | 'LUBRICATION'
  | 'PNEUMATICS'
  | 'BEARING_CAGE'
  | 'THERMAL_LOOP'
  | 'VISION_INSPECT';
export type DashboardTab = 'LANDING' | 'OVERVIEW' | 'INSIGHTS' | 'DIAGNOSTICS' | 'LOGS';
export type LogFilterSeverity = 'ALL' | 'CRIT' | 'WARN';

export interface TelemetryPoint {
  readonly time: string;
  readonly rpm: number;
  readonly bearingTemp: number; // °C
  readonly vibrationRms: number; // mm/s
  readonly hydraulicPressure: number; // bar
  readonly acousticEmission: number; // dB
  readonly powerDraw: number; // kW
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
  readonly oilViscosity: number; // cSt
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
  readonly streamIntervalMs: number;
  readonly packetCount: number;
  readonly activeAlertCount: number;
  readonly aiAnalysisRunning: boolean;
  readonly triggerManualDiagnostics: () => void;
  readonly onOpenIoConfig: () => void;
}

export interface IoConfigModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly apiEndpoint: string;
  readonly setApiEndpoint: (endpoint: string) => void;
  readonly streamIntervalMs: number;
  readonly setStreamIntervalMs: (ms: number) => void;
  readonly streamActive: boolean;
}

// ============================================================================
// 2. MOCK DATA INITIALIZATION & UTILITIES
// ============================================================================

function generateInitialSeries(
  baseRpm: number,
  baseTemp: number,
  baseVib: number,
  basePress: number,
  baseAcoustic: number,
  baseKw: number
): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  const now = Date.now();
  for (let i = 24; i >= 0; i--) {
    const t = new Date(now - i * 5000);
    const timeStr = t.toTimeString().split(' ')[0] ?? '00:00:00';
    points.push({
      time: timeStr,
      rpm: Math.round(baseRpm + (Math.random() - 0.5) * (baseRpm * 0.03)),
      bearingTemp: +(baseTemp + (Math.random() - 0.5) * 1.8).toFixed(1),
      vibrationRms: +(baseVib + (Math.random() - 0.5) * 0.4).toFixed(2),
      hydraulicPressure: Math.round(basePress + (Math.random() - 0.5) * 8),
      acousticEmission: Math.round(baseAcoustic + (Math.random() - 0.5) * 4),
      powerDraw: +(baseKw + (Math.random() - 0.5) * 3.5).toFixed(1),
    });
  }
  return points;
}

const INITIAL_MACHINES: readonly MachineUnit[] = [
  {
    id: 'CNC-501',
    tag: 'MILL-AX-01',
    name: '5-Axis Heavy Machining Center',
    area: 'Cell 3 - Powertrain Machining',
    status: 'WARNING',
    healthIndex: 78.4,
    runtimeHours: 8421.2,
    lastAnomaly: 'Bearing outer race defect frequency (BPFO) harmonic detected',
    activeAlertCount: 2,
    oilViscosity: 44.8,
    telemetry: generateInitialSeries(1450, 68.2, 4.2, 178, 54, 42.5),
  },
  {
    id: 'EXT-104',
    tag: 'EXTR-PLAST-04',
    name: 'Twin-Screw Rotary Extruder',
    area: 'Cell 1 - Polymer Line',
    status: 'CRITICAL',
    healthIndex: 52.1,
    runtimeHours: 12940.0,
    lastAnomaly: 'Thermal runaway zone 3 + hydraulic pressure cavitation',
    activeAlertCount: 4,
    oilViscosity: 38.1,
    telemetry: generateInitialSeries(850, 92.5, 7.8, 235, 76, 68.0),
  },
  {
    id: 'PMP-802',
    tag: 'FEED-HYDR-02',
    name: 'Main Coolant High-Pressure Pump',
    area: 'Utility Vault B',
    status: 'NOMINAL',
    healthIndex: 96.8,
    runtimeHours: 3209.5,
    lastAnomaly: 'None (Self-test passed 04:00 UTC)',
    activeAlertCount: 0,
    oilViscosity: 46.2,
    telemetry: generateInitialSeries(2980, 48.0, 1.1, 142, 38, 18.2),
  },
  {
    id: 'TRB-019',
    tag: 'GEN-COGEN-01',
    name: 'Cogeneration Micro-Turbine',
    area: 'Power Station Bay 2',
    status: 'NOMINAL',
    healthIndex: 91.5,
    runtimeHours: 17830.4,
    lastAnomaly: 'Exhaust gas spread delta within nominal band',
    activeAlertCount: 0,
    oilViscosity: 45.1,
    telemetry: generateInitialSeries(12000, 74.3, 2.3, 195, 62, 120.4),
  },
];

const INITIAL_LOGS: readonly LogEntry[] = [
  {
    id: 'log-1001',
    timestamp: '12:26:45.102',
    machineId: 'EXT-104',
    level: 'CRIT',
    subsystem: 'THERMAL_LOOP',
    message: 'Zone 3 thermocouple differential > 14.5°C over setpoint. PID trim saturated.',
    metricTrigger: 'T_ZONE3=93.4°C > LIM=85.0°C',
  },
  {
    id: 'log-1002',
    timestamp: '12:26:30.820',
    machineId: 'EXT-104',
    level: 'WARN',
    subsystem: 'PNEUMATICS',
    message: 'Hydraulic accumulator cycle delta collapsed from 4.2s to 1.1s. Cavitation probable.',
    metricTrigger: 'HYDR_P_DELTA=38bar',
  },
  {
    id: 'log-1003',
    timestamp: '12:25:58.411',
    machineId: 'CNC-501',
    level: 'WARN',
    subsystem: 'BEARING_CAGE',
    message: 'Spindle acceleration peak envelope spectrum matches BPFO defect harmonics (238 Hz).',
    metricTrigger: 'VIB_RMS=4.38mm/s (warn: 3.5)',
  },
  {
    id: 'log-1004',
    timestamp: '12:24:12.004',
    machineId: 'PMP-802',
    level: 'INFO',
    subsystem: 'LUBRICATION',
    message: 'Differential filter cartridge delta P nominal at 0.42 bar. Bypass closed.',
  },
  {
    id: 'log-1005',
    timestamp: '12:21:05.619',
    machineId: 'TRB-019',
    level: 'INFO',
    subsystem: 'POWERTRAIN',
    message: 'Turbine synchronous generator stator resistance balance check OK. THD 1.2%.',
  },
  {
    id: 'log-1006',
    timestamp: '12:19:44.298',
    machineId: 'CNC-501',
    level: 'DEBUG',
    subsystem: 'VISION_INSPECT',
    message: 'Surface finish roughness metric Ra 0.82 um computed from tool-camera feed #2.',
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
  streamIntervalMs,
  packetCount,
  activeAlertCount,
  aiAnalysisRunning,
  triggerManualDiagnostics,
  onOpenIoConfig,
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
              <span className={streamActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {streamActive ? `LIVE (${streamIntervalMs}ms)` : 'PAUSED'}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">Alerts Active:</span>
              <span className="text-red-700 dark:text-red-400 font-bold">{activeAlertCount}</span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500 mr-1.5">FACILITY:</span>
              <span className="text-zinc-700 dark:text-zinc-300">Sector B - Heavy Assembly</span>
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
  apiEndpoint,
  setApiEndpoint,
  streamIntervalMs,
  setStreamIntervalMs,
  streamActive,
}: IoConfigModalProps): ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-400 dark:border-zinc-700 w-full max-w-lg p-5 font-mono text-xs shadow-2xl">
        <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
            SCADA I/O Integration Gateway
          </span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-bold"
          >
            [X]
          </button>
        </div>

        <p className="text-xs font-sans text-zinc-600 dark:text-zinc-400 mb-4">
          Configure real-time industrial telemetry ingress. When connected, the mock generator yields to live WebSocket / MQTT edge brokers.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">
              Edge Broker WebSocket URI
            </label>
            <input
              type="text"
              value={apiEndpoint}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiEndpoint(e.target.value)}
              className="w-full p-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">
              Polling Stream Interval (ms)
            </label>
            <div className="flex gap-2">
              {[1000, 2500, 5000].map((ms: number) => (
                <button
                  key={ms}
                  onClick={() => setStreamIntervalMs(ms)}
                  className={`px-3 py-1 border ${
                    streamIntervalMs === ms
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  {ms}ms
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-100 dark:bg-zinc-950 p-2.5 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 space-y-1">
            <div>API Schema: IndustrialDoctor/v4/MachineTelemetryPacket</div>
            <div>Authentication: mTLS X.509 + Bearer Token</div>
            <div>State: {streamActive ? 'Internal Simulation Active' : 'Idle'}</div>
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
              alert(`[IO CONFIG] Saved target broker: ${apiEndpoint}`);
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
  const [selectedMachineId, setSelectedMachineId] = useState<string>('CNC-501');
  const [logs, setLogs] = useState<readonly LogEntry[]>(INITIAL_LOGS);
  const [findings, setFindings] = useState<readonly DiagnosticFinding[]>(INITIAL_FINDINGS);
  const [streamActive, setStreamActive] = useState<boolean>(true);
  const [streamIntervalMs, setStreamIntervalMs] = useState<number>(2500);
  const [packetCount, setPacketCount] = useState<number>(1420);
  const [activeFilterSeverity, setActiveFilterSeverity] = useState<LogFilterSeverity>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [aiAnalysisRunning, setAiAnalysisRunning] = useState<boolean>(false);
  const [apiEndpoint, setApiEndpoint] = useState<string>('ws://scada-broker.lan:8080/v1/telemetry');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);

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

  // Mock Streaming Loop
  useEffect(() => {
    if (!streamActive) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timestampWithMs = `${timeStr}.${ms}`;

      setMachines((prevMachines: readonly MachineUnit[]) =>
        prevMachines.map((m: MachineUnit) => {
          const lastPoint = m.telemetry[m.telemetry.length - 1]!;
          const jitterMult = m.status === 'CRITICAL' ? 2.5 : m.status === 'WARNING' ? 1.4 : 0.6;

          const rpmNoise = (Math.random() - 0.49) * 22 * jitterMult;
          const tempDrift = (Math.random() - 0.48) * 0.4 * jitterMult;
          const vibJitter = (Math.random() - 0.47) * 0.15 * jitterMult;
          const pressJitter = (Math.random() - 0.5) * 2.2 * jitterMult;
          const acousticJitter = (Math.random() - 0.48) * 1.5 * jitterMult;
          const kwJitter = (Math.random() - 0.5) * 1.2 * jitterMult;

          const newPoint: TelemetryPoint = {
            time: timeStr,
            rpm: Math.max(0, Math.round(lastPoint.rpm + rpmNoise)),
            bearingTemp: +(lastPoint.bearingTemp + tempDrift).toFixed(1),
            vibrationRms: +Math.max(0.1, lastPoint.vibrationRms + vibJitter).toFixed(2),
            hydraulicPressure: Math.max(5, Math.round(lastPoint.hydraulicPressure + pressJitter)),
            acousticEmission: Math.max(20, Math.round(lastPoint.acousticEmission + acousticJitter)),
            powerDraw: +Math.max(0, lastPoint.powerDraw + kwJitter).toFixed(1),
          };

          const nextTelemetry = [...m.telemetry.slice(1), newPoint];

          let newStatus = m.status;
          if (newPoint.bearingTemp > 94 || newPoint.vibrationRms > 7.5) {
            newStatus = 'CRITICAL';
          } else if (newPoint.bearingTemp > 72 || newPoint.vibrationRms > 4.0) {
            newStatus = 'WARNING';
          }

          return {
            ...m,
            status: newStatus,
            telemetry: nextTelemetry,
          };
        })
      );

      setPacketCount((c: number) => c + 1);

      if (Math.random() > 0.65) {
        const randomMachine = machines[Math.floor(Math.random() * machines.length)]!;
        const possibleLogs: {
          level: LogSeverity;
          sub: SubsystemType;
          msg: string;
          trigger?: string;
        }[] = [
          { level: 'INFO', sub: 'THERMAL_LOOP', msg: 'Secondary heat exchanger loop flow confirmed 42 L/min.' },
          { level: 'DEBUG', sub: 'POWERTRAIN', msg: 'Resolver zero-pulse synced to quadrature encoder channel B.' },
          {
            level: 'WARN',
            sub: 'BEARING_CAGE',
            msg: 'High-frequency crest factor elevated above ISO threshold (CF=4.6).',
            trigger: 'CF=4.6 > 3.8',
          },
          {
            level: 'INFO',
            sub: 'LUBRICATION',
            msg: 'Lubrication pump intermittent purge cycle finished (350ml dispensed).',
          },
          {
            level: 'CRIT',
            sub: 'PNEUMATICS',
            msg: 'Emergency accumulator relief bypass valve high-differential trigger.',
            trigger: 'ACCUM_DIFF=14.2 bar',
          },
          {
            level: 'DEBUG',
            sub: 'VISION_INSPECT',
            msg: 'In-line thermal vision matrix confirms thermal gradient uniformity.',
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
    }, streamIntervalMs);

    return () => clearInterval(interval);
  }, [streamActive, streamIntervalMs, machines]);

  // Trigger AI Audit Simulation
  const triggerManualDiagnostics = (): void => {
    setAiAnalysisRunning(true);
    setTimeout(() => {
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
      const lastPoint = currentMachine.telemetry[currentMachine.telemetry.length - 1]!;
      const newDiag: DiagnosticFinding = {
        id: `DIAG-${Math.floor(1000 + Math.random() * 9000)}`,
        timestamp: nowStr,
        machineId: currentMachine.id,
        severity: currentMachine.status === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        confidence: +(0.86 + Math.random() * 0.11).toFixed(2),
        title: `Dynamic Telemetry Pattern Correlated: ${currentMachine.name}`,
        rootCauseHypothesis: `Harmonic signature resonance detected across ${currentMachine.tag} rotating elements. Vibration RMS (${lastPoint.vibrationRms} mm/s) coupling with bearing housing temperature ramp.`,
        evidencePoints: [
          `FFT fundamental frequency tracking correlates with ${lastPoint.rpm} RPM operational shaft speed`,
          `Current bearing temp ${lastPoint.bearingTemp} °C exceeds steady-state regression curve by +14.2%`,
          `Sensor packet continuity verified across 100% of samples (no lost frame drops)`,
        ],
        recommendedAction:
          'Engage mechanical maintenance crew for laser alignment and grease pack replenishment on drive-end bearing. Verify seal integrity.',
        status: 'PENDING_ACK',
      };
      setFindings((prev: readonly DiagnosticFinding[]) => [newDiag, ...prev]);
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
        streamIntervalMs={streamIntervalMs}
        packetCount={packetCount}
        activeAlertCount={activeAlertCount}
        aiAnalysisRunning={aiAnalysisRunning}
        triggerManualDiagnostics={triggerManualDiagnostics}
        onOpenIoConfig={() => setShowConfigModal(true)}
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
                    {/* Channel 1: RPM */}
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-01.RPM</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Shaft Rotational Speed</div>
                        <div className="text-[10px] text-zinc-400">Primary drive optical quadrature encoder</div>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {currentLatestPoint.rpm}
                        <span className="text-zinc-400 text-xs ml-1 font-normal">RPM</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">Target ± 5.0%</td>
                      <td className="py-2.5 px-3">
                        <SvgSparkline
                          data={currentMachine.telemetry.map((p: TelemetryPoint) => p.rpm)}
                          color="#2563eb"
                          height={28}
                          width={190}
                          fill
                          showMinMax
                          unit="rpm"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold">SYNCHRONOUS</span>
                      </td>
                    </tr>

                    {/* Channel 2: Bearing Temp */}
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-02.TEMP</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Drive-End Bearing Temp</div>
                        <div className="text-[10px] text-zinc-400">Class A PT100 RTD embedded probe</div>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-bold">
                        <span
                          className={
                            currentLatestPoint.bearingTemp > 85
                              ? 'text-red-700 dark:text-red-400'
                              : currentLatestPoint.bearingTemp > 70
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }
                        >
                          {currentLatestPoint.bearingTemp}
                        </span>
                        <span className="text-zinc-400 text-xs ml-1 font-normal">°C</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                        Warn &gt; 70.0 | Crit &gt; 85.0
                      </td>
                      <td className="py-2.5 px-3">
                        <SvgSparkline
                          data={currentMachine.telemetry.map((p: TelemetryPoint) => p.bearingTemp)}
                          color={
                            currentLatestPoint.bearingTemp > 85
                              ? '#dc2626'
                              : currentLatestPoint.bearingTemp > 70
                              ? '#d97706'
                              : '#059669'
                          }
                          height={28}
                          width={190}
                          fill
                          showMinMax
                          unit="°C"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        {currentLatestPoint.bearingTemp > 85 ? (
                          <span className="text-red-700 dark:text-red-400 font-bold text-[11px]">Thermal Alarm</span>
                        ) : currentLatestPoint.bearingTemp > 70 ? (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold text-[11px]">ELEVATED</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">OPTIMAL</span>
                        )}
                      </td>
                    </tr>

                    {/* Channel 3: Vibration RMS */}
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-03.VIB</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Triaxial Vibration RMS</div>
                        <div className="text-[10px] text-zinc-400">Piezoelectric accelerometer 10-1000Hz (ISO 10816-3)</div>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-bold">
                        <span
                          className={
                            currentLatestPoint.vibrationRms > 6.0
                              ? 'text-red-700 dark:text-red-400'
                              : currentLatestPoint.vibrationRms > 3.5
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }
                        >
                          {currentLatestPoint.vibrationRms}
                        </span>
                        <span className="text-zinc-400 text-xs ml-1 font-normal">mm/s</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                        ISO Alert &gt; 3.50 | Trip &gt; 7.10
                      </td>
                      <td className="py-2.5 px-3">
                        <SvgSparkline
                          data={currentMachine.telemetry.map((p: TelemetryPoint) => p.vibrationRms)}
                          color={
                            currentLatestPoint.vibrationRms > 6.0
                              ? '#dc2626'
                              : currentLatestPoint.vibrationRms > 3.5
                              ? '#d97706'
                              : '#2563eb'
                          }
                          height={28}
                          width={190}
                          fill
                          showMinMax
                          unit="mm/s"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        {currentLatestPoint.vibrationRms > 6.0 ? (
                          <span className="text-red-700 dark:text-red-400 font-bold text-[11px]">Harmonic Fault</span>
                        ) : currentLatestPoint.vibrationRms > 3.5 ? (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold text-[11px]">High Restrict</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">Zone A Accept</span>
                        )}
                      </td>
                    </tr>

                    {/* Channel 4: Hydraulic Pressure */}
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-04.HYD</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Main Hydraulic Loop Pressure</div>
                        <div className="text-[10px] text-zinc-400">Piezoresistive pressure transducer 0-350 bar</div>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {currentLatestPoint.hydraulicPressure}
                        <span className="text-zinc-400 text-xs ml-1 font-normal">bar</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">Nominal 140 - 240 bar</td>
                      <td className="py-2.5 px-3">
                        <SvgSparkline
                          data={currentMachine.telemetry.map((p: TelemetryPoint) => p.hydraulicPressure)}
                          color="#475569"
                          height={28}
                          width={190}
                          fill
                          showMinMax
                          unit="bar"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold">Pressure Lock</span>
                      </td>
                    </tr>

                    {/* Channel 5: Acoustic Ultrasound */}
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-05.AE</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Acoustic Ultrasound Emission</div>
                        <div className="text-[10px] text-zinc-400">Contact ultrasonic resonance sensor (20-100 kHz)</div>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {currentLatestPoint.acousticEmission}
                        <span className="text-zinc-400 text-xs ml-1 font-normal">dBμV</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                        Baseline + 18 dB threshold
                      </td>
                      <td className="py-2.5 px-3">
                        <SvgSparkline
                          data={currentMachine.telemetry.map((p: TelemetryPoint) => p.acousticEmission)}
                          color="#059669"
                          height={28}
                          width={190}
                          fill
                          showMinMax
                          unit="dB"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold">Normal Decibel</span>
                      </td>
                    </tr>

                    {/* Channel 6: Electrical Power */}
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300">SIG-06.POW</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">True Active Power Draw</div>
                        <div className="text-[10px] text-zinc-400">3-Phase Hall effect power analyzer meter</div>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {currentLatestPoint.powerDraw}
                        <span className="text-zinc-400 text-xs ml-1 font-normal">kW</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">Efficiency cosφ = 0.92</td>
                      <td className="py-2.5 px-3">
                        <SvgSparkline
                          data={currentMachine.telemetry.map((p: TelemetryPoint) => p.powerDraw)}
                          color="#2563eb"
                          height={28}
                          width={190}
                          fill
                          showMinMax
                          unit="kW"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-blue-700 dark:text-blue-400 text-[11px] font-semibold">Grid Sync</span>
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
                    <div className="w-28 h-20 border-2 border-dashed border-amber-500 bg-amber-500/10 flex flex-col justify-between p-1">
                      <span className="text-[9px] text-amber-400 bg-black/70 px-1 self-start">Defect Detection Region</span>
                      <span className="text-[8px] text-amber-300 self-end font-mono">CONF: 91.2%</span>
                    </div>
                    <span className="text-[10px] text-zinc-300 mt-2 bg-black/75 px-1.5 py-0.5">
                      TARGET: Spindle Housing Chamfer
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
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Bearing Assembly</span>
                      <span className="text-amber-700 dark:text-amber-400 font-bold">WEAR: 24%</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-amber-600 h-full" style={{ width: '24%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      RUL (Remaining Useful Life): ~480 operating hours. Outer ring fatigue signature tracked.
                    </div>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Lubrication Quality</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                        {currentMachine.oilViscosity} cSt (NOMINAL)
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-emerald-600 h-full" style={{ width: '88%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Moisture content &lt; 45 ppm. ISO 4406 Cleanliness rating: 16/14/11.
                    </div>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Seal Integrity</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">96% EFFICIENCY</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-emerald-600 h-full" style={{ width: '96%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Zero continuous weepage. Bypass pressure relief threshold verified.
                    </div>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">Stator Insulation</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">&gt; 100 MΩ (CLASS F)</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5">
                      <div className="bg-emerald-600 h-full" style={{ width: '92%' }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Partial discharge index within baseline tolerance. Megger testing verified.
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-zinc-500">Command Override:</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => alert(`[SCADA] Recalibration packet dispatched to ${currentMachine.id}`)}
                      className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded-none text-[11px]"
                    >
                      Tare Accelerometers
                    </button>
                    <button
                      onClick={() => alert(`[SCADA] Oil purge cycle initiated for ${currentMachine.id}`)}
                      className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded-none text-[11px]"
                    >
                      Purge Lubricant
                    </button>
                    <button
                      onClick={triggerManualDiagnostics}
                      className="px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white border border-blue-900 rounded-none text-[11px] font-semibold"
                    >
                      Analyze Machine Anomalies
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
        apiEndpoint={apiEndpoint}
        setApiEndpoint={setApiEndpoint}
        streamIntervalMs={streamIntervalMs}
        setStreamIntervalMs={setStreamIntervalMs}
        streamActive={streamActive}
      />

      {/* 4. Industrial SCADA System Footer */}
      <footer className="border-t border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-[10px] font-mono text-zinc-500 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-3">
          <span>MachSight Industrial Doctor // Security Zone 3</span>
          <span>COMPLIANCE: IEC 62443 / ISO 13374</span>
        </div>
        <div className="flex items-center gap-4">
          <span>UTC Time: 2026-09-26 12:27:00</span>
          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">All Channels Active</span>
        </div>
      </footer>
    </div>
  );
}
