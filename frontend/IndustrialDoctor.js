import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo, useRef } from 'react';
// ============================================================================
// 2. MOCK DATA INITIALIZATION & UTILITIES
// ============================================================================
function generateInitialSeries(baseDistance, baseCurrent, baseRpm, baseMode, basePwm) {
    const points = [];
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
const INITIAL_MACHINES = [
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
const INITIAL_LOGS = [
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
const INITIAL_FINDINGS = [
    {
        id: 'DIAG-8821',
        timestamp: '2026-09-26 12:15 UTC',
        machineId: 'EXT-104',
        severity: 'HIGH',
        confidence: 0.94,
        title: 'Severe Hydraulic Cavitation & Barrel Zone 3 Thermal Runaway',
        rootCauseHypothesis: 'Proportional throttle valve spool sticking due to hydraulic fluid thermal breakdown (viscosity degraded to 38.1 cSt). High fluid friction generating localized barrel shear heating.',
        evidencePoints: [
            'Acoustic emission frequency spikes at 28.4 kHz (bubble collapse signature)',
            'Hydraulic pressure fluctuation variance increased 410% in last 120 mins',
            'Infrared thermal zone 3 steady rise: dT/dt = +0.42°C/min under static feed rate',
            'Optical log: visual discoloration along extruder nozzle collar detected by cam #1',
        ],
        recommendedAction: 'Immediate shift to standby idle. Inspect proportional valve pilot filter. Draw oil sample for Karl Fischer titration & viscosity check. Lock out automated feed screw.',
        status: 'PENDING_ACK',
    },
    {
        id: 'DIAG-8819',
        timestamp: '2026-09-26 11:42 UTC',
        machineId: 'CNC-501',
        severity: 'MEDIUM',
        confidence: 0.87,
        title: 'Spindle Bearing Outer Raceway Spalling (BPFO Signature)',
        rootCauseHypothesis: 'Micro-spalling on spindle front roller assembly outer ring due to dynamic unbalance during deep pocket milling roughing operations.',
        evidencePoints: [
            'Vibration RMS reached 4.41 mm/s exceeding ISO 10816-3 Class II Alert limit (3.5 mm/s)',
            'Kurtosis metric elevated to 5.2 (Gaussian baseline = 3.0)',
            'Envelope spectral analysis identifies clear peaks at 1x, 2x, 3x BPFO (238 Hz, 476 Hz)',
        ],
        recommendedAction: 'Limit spindle RPM to max 7,500 rpm. Schedule off-shift replacement of front bearing cartridge within 48 operating hours. Re-torque tool clamping drawbar.',
        status: 'TRIAGED',
    },
];
const DEFECT_FREQUENCIES = [
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
export function StatusBadge({ status }) {
    switch (status) {
        case 'NOMINAL':
            return (_jsxs("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800", children: [_jsx("span", { className: "w-1.5 h-1.5 mr-1 rounded-full bg-emerald-500 animate-pulse" }), "NOMINAL"] }));
        case 'WARNING':
            return (_jsxs("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800", children: [_jsx("span", { className: "w-1.5 h-1.5 mr-1 rounded-full bg-amber-500" }), "WARN_THRESH"] }));
        case 'CRITICAL':
            return (_jsxs("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wide bg-red-100 text-red-800 border border-red-400 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800 animate-pulse", children: [_jsx("span", { className: "w-1.5 h-1.5 mr-1 rounded-full bg-red-600" }), "CRIT_ALARM"] }));
        case 'OFFLINE':
            return (_jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide bg-zinc-100 text-zinc-600 border border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700", children: "OFFLINE" }));
    }
}
export function LogLevelBadge({ level }) {
    switch (level) {
        case 'CRIT':
            return _jsx("span", { className: "font-mono text-[10px] font-bold text-red-600 dark:text-red-400", children: "CRIT" });
        case 'WARN':
            return _jsx("span", { className: "font-mono text-[10px] font-bold text-amber-600 dark:text-amber-400", children: "WARN" });
        case 'INFO':
            return _jsx("span", { className: "font-mono text-[10px] font-medium text-blue-600 dark:text-blue-400", children: "INFO" });
        case 'DEBUG':
            return _jsx("span", { className: "font-mono text-[10px] text-zinc-500 dark:text-zinc-400", children: "DBUG" });
    }
}
export function SvgSparkline({ data, color = '#2563eb', height = 36, width = 160, minVal, maxVal, fill = false, showMinMax = false, unit = '', }) {
    if (!data || data.length < 2) {
        return _jsx("div", { className: "text-[10px] text-zinc-400 font-mono", children: "No Data Stream" });
    }
    const computedMin = minVal !== undefined ? minVal : Math.min(...data);
    const computedMax = maxVal !== undefined ? maxVal : Math.max(...data);
    const range = computedMax - computedMin === 0 ? 1 : computedMax - computedMin;
    const paddingY = 4;
    const effectiveH = height - paddingY * 2;
    const points = data
        .map((val, idx) => {
        const x = (idx / (data.length - 1)) * width;
        const normalizedY = (val - computedMin) / range;
        const y = height - paddingY - normalizedY * effectiveH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
        .join(' ');
    const lastVal = data[data.length - 1] ?? 0;
    const firstVal = data[0] ?? 0;
    const delta = lastVal - firstVal;
    return (_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("div", { className: "relative", children: _jsxs("svg", { width: width, height: height, className: "overflow-visible block", style: { shapeRendering: 'geometricPrecision' }, children: [_jsx("line", { x1: "0", y1: paddingY, x2: width, y2: paddingY, stroke: "currentColor", strokeDasharray: "2 3", className: "text-zinc-300 dark:text-zinc-700 opacity-60", strokeWidth: "0.75" }), _jsx("line", { x1: "0", y1: height - paddingY, x2: width, y2: height - paddingY, stroke: "currentColor", strokeDasharray: "2 3", className: "text-zinc-300 dark:text-zinc-700 opacity-60", strokeWidth: "0.75" }), fill && (_jsx("polygon", { points: `0,${height - paddingY} ${points} ${width},${height - paddingY}`, fill: color, fillOpacity: 0.12 })), _jsx("polyline", { fill: "none", stroke: color, strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", points: points }), _jsx("circle", { cx: width.toFixed(1), cy: (height - paddingY - ((lastVal - computedMin) / range) * effectiveH).toFixed(1), r: "2.5", fill: color })] }) }), showMinMax && (_jsxs("div", { className: "flex flex-col text-[9px] font-mono leading-tight text-zinc-500 dark:text-zinc-400 min-w-[58px]", children: [_jsxs("span", { className: "text-zinc-900 dark:text-zinc-200 font-semibold", children: [lastVal, _jsx("span", { className: "text-zinc-400 dark:text-zinc-500 ml-0.5", children: unit })] }), _jsx("span", { className: delta >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400', children: delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1) })] }))] }));
}
export function DashboardHeader({ activeTab, setActiveTab, darkMode, setDarkMode, streamActive, setStreamActive, packetCount, activeAlertCount, aiAnalysisRunning, triggerManualDiagnostics, onOpenIoConfig, isConnected, }) {
    return (_jsxs("header", { className: "border-b border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-40", children: [_jsxs("div", { className: "px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-5 h-5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 flex items-center justify-center font-mono font-bold text-xs rounded-sm", children: "ID" }), _jsxs("div", { className: "flex flex-col", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono text-sm", children: "IndustrialDoctor" }), _jsx("span", { className: "px-1 py-0.2 bg-zinc-200 dark:bg-zinc-800 text-[9px] font-mono text-zinc-600 dark:text-zinc-400 rounded", children: "v4.1.8-PROD" })] }), _jsx("span", { className: "text-[10px] text-zinc-500 font-mono", children: "SCADA AI Diagnostic Agent // Host: plant-master-01" })] })] }), _jsxs("div", { className: "hidden lg:flex items-center gap-4 pl-4 border-l border-zinc-200 dark:border-zinc-800 font-mono text-[11px]", children: [_jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "BUFFER:" }), _jsxs("span", { className: "text-zinc-800 dark:text-zinc-200 font-semibold", children: [packetCount.toLocaleString(), " pkts"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "STREAM:" }), _jsx("span", { className: isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400', children: isConnected ? 'LIVE (WebSocket)' : 'DISCONNECTED' })] }), _jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "Alerts Active:" }), _jsx("span", { className: "text-red-700 dark:text-red-400 font-bold", children: activeAlertCount })] }), _jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "FACILITY:" }), _jsx("span", { className: "text-zinc-700 dark:text-zinc-300", children: "Test Track Zone A" })] })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: () => setStreamActive(!streamActive), title: "Pause or resume live sensor packet ingestion loop", className: `px-2 py-1 font-mono text-[11px] rounded border transition-colors flex items-center gap-1.5 ${streamActive
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                    : 'border-zinc-400 bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'}`, children: [_jsx("span", { className: `w-2 h-2 rounded-full ${streamActive ? 'bg-emerald-600 animate-ping' : 'bg-zinc-400'}` }), streamActive ? 'Stream Active' : 'Stream Paused'] }), _jsx("button", { onClick: triggerManualDiagnostics, disabled: aiAnalysisRunning, className: "px-2.5 py-1 font-mono text-[11px] font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 rounded border border-transparent disabled:opacity-50 flex items-center gap-1.5", children: aiAnalysisRunning ? (_jsxs(_Fragment, { children: [_jsxs("svg", { className: "animate-spin h-3 w-3", viewBox: "0 0 24 24", fill: "none", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" })] }), "Synthesizing..."] })) : ('Trigger AI Audit') }), _jsx("button", { onClick: onOpenIoConfig, className: "px-2 py-1 font-mono text-[11px] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-50 dark:hover:bg-zinc-750", children: "IO_CFG" }), _jsx("button", { onClick: () => setDarkMode(!darkMode), className: "px-2 py-1 font-mono text-[11px] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-50 dark:hover:bg-zinc-750 flex items-center gap-1", "aria-label": "Toggle Theme", children: _jsx("span", { className: "font-semibold", children: darkMode ? 'THEME: DARK' : 'THEME: LIGHT' }) })] })] }), _jsx("nav", { className: "px-4 flex items-center gap-1 border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/60 overflow-x-auto text-xs", children: [
                    { id: 'LANDING', label: 'System Gateway' },
                    { id: 'OVERVIEW', label: '[1] Telemetry Matrix' },
                    { id: 'INSIGHTS', label: '[2] Spectrograms', tag: 'FFT' },
                    { id: 'DIAGNOSTICS', label: '[3] AI Diagnostics' },
                    { id: 'LOGS', label: '[4] Event Logs' },
                ].map((tab) => (_jsxs("button", { onClick: () => setActiveTab(tab.id), className: `px-3 py-2 font-mono font-medium border-b-2 tracking-wide transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeTab === tab.id
                        ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-white dark:bg-zinc-800/80'
                        : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`, children: [tab.label, tab.tag ? (_jsx("span", { className: "px-1 py-0.1 text-[9px] bg-zinc-200 dark:bg-zinc-700 rounded font-bold", children: tab.tag })) : null] }, tab.id))) })] }));
}
export function IoConfigModal({ isOpen, onClose, wsEndpoint, setWsEndpoint, streamActive, isConnected, }) {
    if (!isOpen)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", children: _jsxs("div", { className: "bg-white dark:bg-zinc-900 border border-zinc-400 dark:border-zinc-700 w-full max-w-lg p-5 font-mono text-xs shadow-2xl", children: [_jsxs("div", { className: "flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4", children: [_jsx("span", { className: "font-bold text-sm text-zinc-900 dark:text-zinc-100", children: "WebSocket Configuration" }), _jsx("button", { onClick: onClose, className: "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-bold", children: "[X]" })] }), _jsx("p", { className: "text-xs font-sans text-zinc-600 dark:text-zinc-400 mb-4", children: "Configure WebSocket connection to MachSight backend for real-time RC car telemetry and AI diagnosis events." }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-[10px] uppercase font-bold text-zinc-500 mb-1", children: "WebSocket Endpoint" }), _jsx("input", { type: "text", value: wsEndpoint, onChange: (e) => setWsEndpoint(e.target.value), className: "w-full p-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:border-blue-600" })] }), _jsxs("div", { className: "bg-zinc-100 dark:bg-zinc-950 p-2.5 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 space-y-1", children: [_jsx("div", { children: "Backend API: MachSight FastAPI WebSocket" }), _jsx("div", { children: "Event Types: processed, investigation_step, diagnosis" }), _jsxs("div", { children: ["Connection Status: ", isConnected ? 'CONNECTED' : 'DISCONNECTED'] }), _jsxs("div", { children: ["Stream State: ", streamActive ? 'ACTIVE' : 'PAUSED'] })] })] }), _jsxs("div", { className: "mt-5 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2", children: [_jsx("button", { onClick: onClose, className: "px-3 py-1.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs border border-zinc-300 dark:border-zinc-700", children: "Dismiss" }), _jsx("button", { onClick: () => {
                                onClose();
                            }, className: "px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs border border-blue-900", children: "Apply Configuration" })] })] }) }));
}
// ============================================================================
// 4. MAIN DASHBOARD CONTAINER COMPONENT
// ============================================================================
export default function IndustrialDoctorApp() {
    const [darkMode, setDarkMode] = useState(false);
    const [activeTab, setActiveTab] = useState('OVERVIEW');
    const [machines, setMachines] = useState(INITIAL_MACHINES);
    const [selectedMachineId, setSelectedMachineId] = useState('RC-01');
    const [logs, setLogs] = useState(INITIAL_LOGS);
    const [findings, setFindings] = useState(INITIAL_FINDINGS);
    const [streamActive, setStreamActive] = useState(true);
    const [packetCount, setPacketCount] = useState(0);
    const [activeFilterSeverity, setActiveFilterSeverity] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [aiAnalysisRunning, setAiAnalysisRunning] = useState(false);
    const [wsEndpoint, setWsEndpoint] = useState('ws://localhost:8000/ws');
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [currentDiagnosis, setCurrentDiagnosis] = useState(null);
    const [highlightMetrics, setHighlightMetrics] = useState([]);
    const [anomalyDetected, setAnomalyDetected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const lastUpdateTimeRef = useRef(0);
    const telemetryBufferRef = useRef(new Map());
    // Initialize telemetry buffer for each machine
    useEffect(() => {
        const buffer = new Map();
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
                        const data = JSON.parse(event.data);
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
                            }
                            else {
                                setAnomalyDetected(false);
                            }
                        }
                        else if ((data.type === 'investigation_step' || data.type === 'diagnosis') && data.data?.payload) {
                            // Double-encoded JSON: parse the payload string
                            try {
                                const parsedPayload = JSON.parse(data.data.payload);
                                if (data.type === 'diagnosis') {
                                    setCurrentDiagnosis(parsedPayload);
                                    setAiAnalysisRunning(false);
                                    // Add to findings if it's a final diagnosis
                                    if (parsedPayload.stage === 'final' && parsedPayload.diagnosis && parsedPayload.diagnosis !== 'inconclusive') {
                                        const newFinding = {
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
                            }
                            catch (parseError) {
                                console.error('Failed to parse payload:', parseError);
                            }
                        }
                    }
                    catch (error) {
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
            }
            catch (error) {
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
        if (!streamActive || !isConnected)
            return;
        const interval = setInterval(() => {
            const now = new Date();
            const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';
            setMachines((prevMachines) => prevMachines.map((m) => {
                const lastPoint = m.telemetry[m.telemetry.length - 1];
                const jitterMult = m.status === 'CRITICAL' ? 2.5 : m.status === 'WARNING' ? 1.4 : 0.6;
                const distanceNoise = (Math.random() - 0.5) * 5 * jitterMult;
                const currentNoise = (Math.random() - 0.5) * 0.3 * jitterMult;
                const rpmNoise = (Math.random() - 0.5) * 30 * jitterMult;
                const pwmNoise = (Math.random() - 0.5) * 5 * jitterMult;
                const newPoint = {
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
                }
                else if (newPoint.current_a > 3.5 || newPoint.rpm < 500) {
                    newStatus = 'WARNING';
                }
                else {
                    newStatus = 'NOMINAL';
                }
                return {
                    ...m,
                    status: newStatus,
                    telemetry: nextTelemetry,
                };
            }));
        }, 100); // 10Hz max update rate
        return () => clearInterval(interval);
    }, [streamActive, isConnected]);
    // Sync dark class to DOM root
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        }
        else {
            document.documentElement.classList.remove('dark');
        }
    }, [darkMode]);
    // Selected Machine with Fallback
    const currentMachine = useMemo(() => {
        return machines.find((m) => m.id === selectedMachineId) ?? machines[0];
    }, [machines, selectedMachineId]);
    // Mock Streaming Loop (for logs only - telemetry comes from WebSocket)
    useEffect(() => {
        if (!streamActive)
            return;
        const interval = setInterval(() => {
            const now = new Date();
            const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';
            const ms = String(now.getMilliseconds()).padStart(3, '0');
            const timestampWithMs = `${timeStr}.${ms}`;
            if (Math.random() > 0.65) {
                const randomMachine = machines[Math.floor(Math.random() * machines.length)];
                const possibleLogs = [
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
                const picked = possibleLogs[Math.floor(Math.random() * possibleLogs.length)];
                const newLogEntry = {
                    id: `log-${Date.now()}-${Math.floor(Math.random() * 999)}`,
                    timestamp: timestampWithMs,
                    machineId: randomMachine.id,
                    level: picked.level,
                    subsystem: picked.sub,
                    message: picked.msg,
                    metricTrigger: picked.trigger,
                };
                setLogs((prev) => [newLogEntry, ...prev.slice(0, 79)]);
            }
        }, 2500);
        return () => clearInterval(interval);
    }, [streamActive, machines]);
    // Trigger AI Audit Simulation (placeholder - real diagnosis comes from WebSocket)
    const triggerManualDiagnostics = () => {
        setAiAnalysisRunning(true);
        // In real implementation, this would send a request to backend to trigger investigation
        // For now, we'll simulate after a delay
        setTimeout(() => {
            setAiAnalysisRunning(false);
            setActiveTab('DIAGNOSTICS');
        }, 1200);
    };
    // Filtered SCADA Logs
    const filteredLogs = useMemo(() => {
        return logs.filter((log) => {
            const matchesSev = activeFilterSeverity === 'ALL'
                ? true
                : activeFilterSeverity === 'CRIT'
                    ? log.level === 'CRIT'
                    : log.level === 'WARN' || log.level === 'CRIT';
            const matchesSearch = searchQuery.trim() === ''
                ? true
                : log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    log.machineId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    log.subsystem.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesSev && matchesSearch;
        });
    }, [logs, activeFilterSeverity, searchQuery]);
    const activeAlertCount = useMemo(() => {
        return machines.reduce((acc, curr) => acc + curr.activeAlertCount, 0);
    }, [machines]);
    const currentLatestPoint = currentMachine.telemetry[currentMachine.telemetry.length - 1];
    return (_jsxs("div", { className: "min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 font-sans selection:bg-zinc-300 dark:selection:bg-zinc-700 transition-colors duration-150", children: [_jsx(DashboardHeader, { activeTab: activeTab, setActiveTab: setActiveTab, darkMode: darkMode, setDarkMode: setDarkMode, streamActive: streamActive, setStreamActive: setStreamActive, packetCount: packetCount, activeAlertCount: activeAlertCount, aiAnalysisRunning: aiAnalysisRunning, triggerManualDiagnostics: triggerManualDiagnostics, onOpenIoConfig: () => setShowConfigModal(true), isConnected: isConnected }), _jsxs("main", { className: "p-4 max-w-[1920px] mx-auto space-y-4", children: [activeTab === 'LANDING' && (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 rounded-none shadow-sm", children: [_jsxs("div", { className: "flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5", children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs text-blue-700 dark:text-blue-400 font-semibold mb-1", children: "System Overview // Industrial Diagnostic Agent" }), _jsx("h1", { className: "text-2xl font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-100", children: "Industrial Machine Health & Predictive Diagnostic Engine" }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400 font-sans mt-1 max-w-3xl leading-relaxed", children: "Edge-deployed autonomous inference platform monitoring high-duty rotating industrial machinery. Continuous multi-modal telemetry correlation combining accelerometer vibration metrics, thermocouple heat loops, hydraulic transducer profiles, and visual quality audit streams." })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => setActiveTab('OVERVIEW'), className: "px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm", children: "Enter Dashboard \u2192" }), _jsx("button", { onClick: () => setActiveTab('DIAGNOSTICS'), className: "px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs border border-zinc-300 dark:border-zinc-700", children: "Active RCA Findings" })] })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-5", children: [_jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Fleet Online" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: "4 / 4" }), _jsx("div", { className: "text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5", children: "100% QUORUM" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "System Health (Mean)" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: "79.7%" }), _jsx("div", { className: "text-[10px] font-mono text-amber-700 dark:text-amber-400 mt-0.5", children: "-3.2% 24h delta" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Active Trips / Alarms" }), _jsx("div", { className: "text-xl font-mono font-bold text-red-700 dark:text-red-400 mt-1", children: "1 CRIT / 1 WARN" }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-0.5", children: "ISO 10816 CLASS II" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Inference Latency" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: "18.4 ms" }), _jsx("div", { className: "text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5", children: "Edge TPU Online" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Total Runtime Hours" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: "42,401.1" }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-0.5", children: "MTBF 4,200h" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Protocol Gateway" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: "OPC-UA / MQTT" }), _jsx("div", { className: "text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5", children: "TLS 1.3 SECURE" })] })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: [_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "Module 01: Sensor Telemetry Bus" }), _jsx("span", { className: "font-mono text-[10px] text-emerald-700 dark:text-emerald-400", children: "STATUS: SYNCED" })] }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400 mb-3", children: "High-frequency time-series buffer aggregating multi-axial accelerometers (Vib RMS), thermistors (Bearing \u00B0C), hydraulic load cells (bar), acoustic microphones (dB), and kW electrical power draw." }), _jsxs("div", { className: "bg-zinc-100 dark:bg-zinc-950 p-2 border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1", children: [_jsx("div", { children: "- Ingestion frequency: 2,500ms cycle" }), _jsx("div", { children: "- Interpolation algorithm: Akima spline" }), _jsx("div", { children: "- Buffer depth: 10,000 pts per machine" })] })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "Module 02: AI Anomaly & RCA Agent" }), _jsx("span", { className: "font-mono text-[10px] text-blue-700 dark:text-blue-400", children: "ENGINE: V4.1-ENG" })] }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400 mb-3", children: "Autonomous diagnostic reasoning agent mapping physical vibration spectra (BPFO, BPFI, BSF, FTF bearing frequencies) with thermal runaway dynamics and oil chemical degradation profiles." }), _jsxs("div", { className: "bg-zinc-100 dark:bg-zinc-950 p-2 border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1", children: [_jsx("div", { children: "- Bayesian fault isolation logic" }), _jsx("div", { children: "- Automated Work Order (CMMS) dispatch payload" }), _jsx("div", { children: "- Cross-subsystem correlation matrix" })] })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "Module 03: Computer Vision Inspection" }), _jsx("span", { className: "font-mono text-[10px] text-emerald-700 dark:text-emerald-400", children: "STREAMS: 4 CAMERAS" })] }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400 mb-3", children: "Synchronous visual inspection stream detecting tool wear, surface spalling, lubricant discoloration, and hydraulic leak pooling via embedded edge camera units." }), _jsxs("div", { className: "bg-zinc-100 dark:bg-zinc-950 p-2 border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1", children: [_jsx("div", { children: "- In-line optical surface roughness (Ra)" }), _jsx("div", { children: "- FLIR thermal camera thresholding" }), _jsx("div", { children: "- 60 fps tool path validation" })] })] })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsx("div", { className: "text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100 mb-2", children: "Active System Units // Select Unit For Inspection" }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-3", children: machines.map((m) => (_jsxs("div", { onClick: () => {
                                                setSelectedMachineId(m.id);
                                                setActiveTab('OVERVIEW');
                                            }, className: `p-3 border cursor-pointer transition-colors ${selectedMachineId === m.id
                                                ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                                                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700'}`, children: [_jsxs("div", { className: "flex justify-between items-start mb-1", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: m.id }), _jsx(StatusBadge, { status: m.status })] }), _jsx("div", { className: "text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate", children: m.name }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-1", children: m.area }), _jsxs("div", { className: "mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center text-[10px] font-mono", children: [_jsxs("span", { children: ["HEALTH: ", m.healthIndex, "%"] }), _jsx("span", { className: "text-blue-600 dark:text-blue-400 font-semibold", children: "View Matrix \u2192" })] })] }, m.id))) })] })] })), activeTab === 'OVERVIEW' && (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3", children: _jsxs("div", { className: "flex flex-col md:flex-row md:items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xs font-mono font-bold text-zinc-500 uppercase", children: "Active Unit:" }), _jsx("div", { className: "flex flex-wrap gap-1", children: machines.map((m) => (_jsxs("button", { onClick: () => setSelectedMachineId(m.id), className: `px-2.5 py-1 font-mono text-xs font-semibold border transition-colors ${selectedMachineId === m.id
                                                            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                                                            : 'bg-zinc-50 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-750'}`, children: [m.id, " [", m.tag, "]"] }, m.id))) })] }), _jsxs("div", { className: "flex items-center gap-3 text-xs font-mono", children: [_jsx("span", { className: "text-zinc-500", children: "STATUS:" }), _jsx(StatusBadge, { status: currentMachine.status }), _jsx("span", { className: "text-zinc-500 ml-2", children: "HEALTH:" }), _jsxs("span", { className: `font-bold ${currentMachine.healthIndex > 85
                                                        ? 'text-emerald-700 dark:text-emerald-400'
                                                        : currentMachine.healthIndex > 65
                                                            ? 'text-amber-700 dark:text-amber-400'
                                                            : 'text-red-700 dark:text-red-400'}`, children: [currentMachine.healthIndex, "%"] }), _jsx("span", { className: "text-zinc-500 ml-2", children: "Run Hours:" }), _jsxs("span", { className: "font-semibold text-zinc-800 dark:text-zinc-200", children: [currentMachine.runtimeHours.toLocaleString(), " h"] })] })] }) }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden", children: [_jsxs("div", { className: "px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: ["REAL-TIME SENSOR TELEMETRY BUS // ", currentMachine.id, " - ", currentMachine.name] }), _jsxs("span", { className: "font-mono text-[10px] text-zinc-500", children: ["[", currentMachine.area, "]"] })] }), _jsxs("div", { className: "text-[11px] font-mono text-zinc-500 flex items-center gap-2", children: [_jsx("span", { children: "SAMPLES: 25 PT WINDOW" }), _jsx("span", { className: "w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping" })] })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-left text-xs font-mono border-collapse", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/80 text-[10px] text-zinc-500 uppercase tracking-wider", children: [_jsx("th", { className: "py-2 px-3", children: "Channel ID" }), _jsx("th", { className: "py-2 px-3", children: "Parameter" }), _jsx("th", { className: "py-2 px-3", children: "Current Value" }), _jsx("th", { className: "py-2 px-3", children: "Setpoint / Band" }), _jsx("th", { className: "py-2 px-3", children: "Signal Trend (2m Sparkline)" }), _jsx("th", { className: "py-2 px-3", children: "Status Indicator" })] }) }), _jsxs("tbody", { className: "divide-y divide-zinc-200 dark:divide-zinc-800", children: [_jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-01.DIST" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Ultrasonic Distance" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Front-facing ultrasonic range sensor" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100", children: [currentLatestPoint.distance_cm, _jsx("span", { className: "text-zinc-400 text-xs ml-1 font-normal", children: "cm" })] }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "Range: 2-400 cm" }), _jsx("td", { className: "py-2.5 px-3", children: _jsx(SvgSparkline, { data: currentMachine.telemetry.map((p) => p.distance_cm), color: highlightMetrics.includes('distance_cm') ? '#d97706' : '#2563eb', height: 28, width: 190, fill: true, showMinMax: true, unit: "cm" }) }), _jsx("td", { className: "py-2.5 px-3", children: highlightMetrics.includes('distance_cm') ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-bold text-[11px]", children: "INVESTIGATING" })) : (_jsx("span", { className: "text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold", children: "NOMINAL" })) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-02.CURR" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Motor Current" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "DC motor current draw sensor" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold", children: [_jsx("span", { className: currentLatestPoint.current_a > 5.0
                                                                                ? 'text-red-700 dark:text-red-400'
                                                                                : currentLatestPoint.current_a > 3.5
                                                                                    ? 'text-amber-700 dark:text-amber-400'
                                                                                    : 'text-zinc-900 dark:text-zinc-100', children: currentLatestPoint.current_a }), _jsx("span", { className: "text-zinc-400 text-xs ml-1 font-normal", children: "A" })] }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "Warn > 3.5A | Crit > 5.0A" }), _jsx("td", { className: "py-2.5 px-3", children: _jsx(SvgSparkline, { data: currentMachine.telemetry.map((p) => p.current_a), color: highlightMetrics.includes('current_a')
                                                                            ? '#d97706'
                                                                            : currentLatestPoint.current_a > 5.0
                                                                                ? '#dc2626'
                                                                                : currentLatestPoint.current_a > 3.5
                                                                                    ? '#d97706'
                                                                                    : '#059669', height: 28, width: 190, fill: true, showMinMax: true, unit: "A" }) }), _jsx("td", { className: "py-2.5 px-3", children: highlightMetrics.includes('current_a') ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-bold text-[11px]", children: "INVESTIGATING" })) : currentLatestPoint.current_a > 5.0 ? (_jsx("span", { className: "text-red-700 dark:text-red-400 font-bold text-[11px]", children: "OVERLOAD" })) : currentLatestPoint.current_a > 3.5 ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-semibold text-[11px]", children: "ELEVATED" })) : (_jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]", children: "NOMINAL" })) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-03.RPM" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Motor RPM" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Optical encoder speed feedback" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold", children: [_jsx("span", { className: currentLatestPoint.rpm < 100
                                                                                ? 'text-red-700 dark:text-red-400'
                                                                                : currentLatestPoint.rpm < 500
                                                                                    ? 'text-amber-700 dark:text-amber-400'
                                                                                    : 'text-zinc-900 dark:text-zinc-100', children: currentLatestPoint.rpm }), _jsx("span", { className: "text-zinc-400 text-xs ml-1 font-normal", children: "RPM" })] }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "Warn < 500 | Crit < 100" }), _jsx("td", { className: "py-2.5 px-3", children: _jsx(SvgSparkline, { data: currentMachine.telemetry.map((p) => p.rpm), color: highlightMetrics.includes('rpm')
                                                                            ? '#d97706'
                                                                            : currentLatestPoint.rpm < 100
                                                                                ? '#dc2626'
                                                                                : currentLatestPoint.rpm < 500
                                                                                    ? '#d97706'
                                                                                    : '#2563eb', height: 28, width: 190, fill: true, showMinMax: true, unit: "rpm" }) }), _jsx("td", { className: "py-2.5 px-3", children: highlightMetrics.includes('rpm') ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-bold text-[11px]", children: "INVESTIGATING" })) : currentLatestPoint.rpm < 100 ? (_jsx("span", { className: "text-red-700 dark:text-red-400 font-bold text-[11px]", children: "STALL" })) : currentLatestPoint.rpm < 500 ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-semibold text-[11px]", children: "LOW SPEED" })) : (_jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]", children: "NOMINAL" })) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-04.MODE" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Operating Mode" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Motor control mode state" })] }), _jsx("td", { className: "py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100", children: currentLatestPoint.mode }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "forward, idle, reverse" }), _jsx("td", { className: "py-2.5 px-3", children: _jsxs("div", { className: "text-[10px] text-zinc-400 font-mono", children: ["State: ", currentLatestPoint.mode.toUpperCase()] }) }), _jsx("td", { className: "py-2.5 px-3", children: _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold", children: "ACTIVE" }) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-05.PWM" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "PWM Command" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Motor driver PWM signal (0-255)" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100", children: [currentLatestPoint.pwm_command, _jsx("span", { className: "text-zinc-400 text-xs ml-1 font-normal", children: "/255" })] }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "Range: 0-255" }), _jsx("td", { className: "py-2.5 px-3", children: _jsx(SvgSparkline, { data: currentMachine.telemetry.map((p) => p.pwm_command), color: "#475569", height: 28, width: 190, fill: true, showMinMax: true, unit: "" }) }), _jsx("td", { className: "py-2.5 px-3", children: _jsx("span", { className: "text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold", children: "COMMAND SENT" }) })] })] })] }) })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-4", children: [_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-2 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: [_jsx("span", { children: "Optical Inspection Feed // Cam 02" }), _jsx("span", { className: "text-[10px] font-normal text-emerald-700 dark:text-emerald-400 font-mono", children: "60 FPS // 1080p" })] }), _jsxs("div", { className: "relative bg-zinc-950 border border-zinc-700 aspect-video flex flex-col justify-between p-3 font-mono text-white overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 opacity-15 pointer-events-none", style: {
                                                            backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                                                            backgroundSize: '24px 24px',
                                                        } }), _jsxs("div", { className: "relative z-10 flex justify-between items-center text-[10px]", children: [_jsx("span", { className: "text-zinc-400", children: "Frame: #449102" }), _jsx("span", { className: "bg-red-600 px-1 text-white font-bold animate-pulse text-[9px]", children: "Live Rec" })] }), _jsxs("div", { className: "relative z-10 my-auto flex flex-col items-center justify-center", children: [_jsxs("div", { className: `w-28 h-20 border-2 ${anomalyDetected ? 'border-red-500 bg-red-500/20' : 'border-amber-500 bg-amber-500/10'} flex flex-col justify-between p-1 ${anomalyDetected ? 'animate-pulse' : ''}`, children: [_jsx("span", { className: `text-[9px] ${anomalyDetected ? 'text-red-400' : 'text-amber-400'} bg-black/70 px-1 self-start`, children: anomalyDetected ? 'ANOMALY DETECTED' : 'Defect Detection Region' }), _jsxs("span", { className: `text-[8px] ${anomalyDetected ? 'text-red-300' : 'text-amber-300'} self-end font-mono`, children: ["CONF: ", anomalyDetected ? (currentDiagnosis?.confidence ? `${(currentDiagnosis.confidence * 100).toFixed(1)}%` : 'HIGH') : '91.2%'] })] }), _jsxs("span", { className: "text-[10px] text-zinc-300 mt-2 bg-black/75 px-1.5 py-0.5", children: ["TARGET: ", anomalyDetected && currentDiagnosis?.diagnosis ? currentDiagnosis.diagnosis.substring(0, 30) + '...' : 'RC Car Front Chassis'] })] }), _jsxs("div", { className: "relative z-10 flex justify-between text-[9px] text-zinc-400 border-t border-zinc-800 pt-1", children: [_jsx("span", { children: "Exposure: 1/1200s" }), _jsx("span", { children: "Gain: 2.4dB" }), _jsx("span", { children: "Surface Roughness (Ra): 0.82\u03BCm (PASS)" })] })] }), _jsx("div", { className: "mt-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 flex justify-between", children: _jsx("span", { children: "Visual Log: No macro-cracking or lubrication breach detected." }) })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-sm lg:col-span-2", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: [_jsx("span", { children: "Subsystem DEGRADATION INDICES & WEAR PROFILE" }), _jsx("span", { className: "text-[10px] font-mono text-zinc-500", children: "STANDARDS: ISO 13374 / VDI 3832" })] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono", children: [_jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Drivetrain Health" }), _jsx("span", { className: "text-amber-700 dark:text-amber-400 font-bold", children: "WEAR: 24%" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-amber-600 h-full", style: { width: '24%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "RUL (Remaining Useful Life): ~480 operating cycles. Gear mesh wear tracked." })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Motor Assembly" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: currentLatestPoint.current_a < 3.5 ? 'NOMINAL' : 'ELEVATED' })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: currentLatestPoint.current_a < 3.5 ? '88%' : '65%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Current draw within operational parameters. Thermal efficiency nominal." })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Ultrasonic Array" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: "96% ACCURACY" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: '96%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Distance sensor readings stable. Signal-to-noise ratio within specification." })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Battery System" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: "> 85% CAPACITY" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: '92%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Discharge rate stable. Cell voltage balance within tolerance." })] })] }), _jsxs("div", { className: "mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 font-mono text-xs", children: [_jsx("span", { className: "text-zinc-500", children: "Command Override:" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => alert(`[RC CONTROL] Emergency stop dispatched to ${currentMachine.id}`), className: "px-2 py-1 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-none text-[11px]", children: "Emergency Stop" }), _jsx("button", { onClick: () => alert(`[RC CONTROL] Calibrate sensors for ${currentMachine.id}`), className: "px-2 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded-none text-[11px]", children: "Calibrate Sensors" }), _jsx("button", { onClick: triggerManualDiagnostics, className: "px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white border border-blue-900 rounded-none text-[11px] font-semibold", children: "Analyze Anomalies" })] })] })] })] })] })), activeTab === 'INSIGHTS' && (_jsx("div", { className: "space-y-4", children: _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "SPECTRAL FREQUENCY DECOMPOSITION (FFT) & HARMONIC TRACKING" }), _jsxs("div", { className: "text-xs text-zinc-500 font-mono", children: ["MACHINE: ", currentMachine.id, " // BEARING_TYPE: SKF 6208 DEEP GROOVE BALL BEARING"] })] }), _jsxs("div", { className: "flex items-center gap-2 font-mono text-xs", children: [_jsx("span", { className: "text-zinc-400", children: "RESOLUTION:" }), _jsx("span", { className: "px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold border border-zinc-300 dark:border-zinc-700", children: "0.25 Hz / BIN" }), _jsx("span", { className: "text-zinc-400", children: "SAMPLING:" }), _jsx("span", { className: "px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold border border-zinc-300 dark:border-zinc-700", children: "25.6 kHz" })] })] }), _jsx("div", { className: "overflow-x-auto mb-4", children: _jsxs("table", { className: "w-full text-left text-xs font-mono border border-zinc-200 dark:border-zinc-800", children: [_jsx("thead", { className: "bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 text-[10px]", children: _jsxs("tr", { children: [_jsx("th", { className: "py-2 px-3", children: "Fault Type" }), _jsx("th", { className: "py-2 px-3", children: "ACRONYM" }), _jsx("th", { className: "py-2 px-3", children: "Order (Multiple)" }), _jsx("th", { className: "py-2 px-3", children: "Calculated Frequency" }), _jsx("th", { className: "py-2 px-3", children: "Measured Energy" }), _jsx("th", { className: "py-2 px-3", children: "Threshold" })] }) }), _jsx("tbody", { className: "divide-y divide-zinc-200 dark:divide-zinc-800 text-xs", children: DEFECT_FREQUENCIES.map((freq) => (_jsxs("tr", { children: [_jsx("td", { className: "py-2 px-3 font-semibold text-zinc-800 dark:text-zinc-200", children: freq.faultType }), _jsx("td", { className: `py-2 px-3 font-bold ${freq.statusTag === 'ALERT_HIGH'
                                                                ? 'text-red-600 dark:text-red-400'
                                                                : 'text-zinc-600 dark:text-zinc-400'}`, children: freq.acronym }), _jsx("td", { className: "py-2 px-3", children: freq.orderMultiple }), _jsxs("td", { className: "py-2 px-3 font-mono font-bold", children: [freq.frequencyHz, " Hz"] }), _jsxs("td", { className: `py-2 px-3 font-bold ${freq.statusTag === 'ALERT_HIGH'
                                                                ? 'text-amber-700 dark:text-amber-400'
                                                                : 'text-emerald-700 dark:text-emerald-400'}`, children: [freq.measuredEnergyMmS.toFixed(2), " mm/s"] }), _jsxs("td", { className: "py-2 px-3 text-zinc-500", children: [freq.thresholdMmS.toFixed(2), " mm/s (", freq.statusTag, ")"] })] }, freq.acronym))) })] }) }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-zinc-950 p-4 text-white", children: [_jsxs("div", { className: "flex justify-between items-center text-[11px] font-mono text-zinc-400 mb-2", children: [_jsx("span", { children: "VELOCITY SPECTRUM [0 Hz to 500 Hz]" }), _jsx("span", { className: "text-amber-400 font-bold", children: "Harmonic Match: 1x & 2x BPFO Confirmed" })] }), _jsx("div", { className: "w-full h-48 relative flex items-end", children: _jsxs("svg", { className: "w-full h-full", preserveAspectRatio: "none", viewBox: "0 0 1000 200", children: [_jsx("line", { x1: "0", y1: "50", x2: "1000", y2: "50", stroke: "#3f3f46", strokeDasharray: "3 3", strokeWidth: "1" }), _jsx("line", { x1: "0", y1: "100", x2: "1000", y2: "100", stroke: "#3f3f46", strokeDasharray: "3 3", strokeWidth: "1" }), _jsx("line", { x1: "0", y1: "150", x2: "1000", y2: "150", stroke: "#3f3f46", strokeDasharray: "3 3", strokeWidth: "1" }), _jsx("line", { x1: "0", y1: "80", x2: "1000", y2: "80", stroke: "#dc2626", strokeDasharray: "4 2", strokeWidth: "1.5" }), _jsx("text", { x: "10", y: "74", fill: "#dc2626", fontSize: "10", fontFamily: "monospace", children: "ALERT LIMIT = 0.40 mm/s" }), _jsx("polyline", { fill: "none", stroke: "#2563eb", strokeWidth: "1.5", points: "\r\n                        0,195 20,192 40,194 50,140 55,190 70,193 100,194 \r\n                        173,60 178,193 200,194 250,190 300,194 \r\n                        346,110 350,192 400,193 500,195 600,194 700,195 800,194 900,195 1000,195\r\n                      " }), _jsx("circle", { cx: "173", cy: "60", r: "4", fill: "#d97706" }), _jsx("text", { x: "180", y: "55", fill: "#f59e0b", fontSize: "11", fontFamily: "monospace", fontWeight: "bold", children: "BPFO (1X) 86.5 Hz [0.84 mm/s]" }), _jsx("circle", { cx: "346", cy: "110", r: "4", fill: "#d97706" }), _jsx("text", { x: "355", y: "108", fill: "#f59e0b", fontSize: "10", fontFamily: "monospace", children: "BPFO (2X) 173.0 Hz" }), _jsx("circle", { cx: "50", cy: "140", r: "3", fill: "#059669" }), _jsx("text", { x: "56", y: "136", fill: "#10b981", fontSize: "10", fontFamily: "monospace", children: "1X RPM (24.2 Hz)" })] }) }), _jsxs("div", { className: "flex justify-between items-center text-[10px] font-mono text-zinc-500 border-t border-zinc-800 pt-2 mt-1", children: [_jsx("span", { children: "0 Hz" }), _jsx("span", { children: "100 Hz" }), _jsx("span", { children: "200 Hz" }), _jsx("span", { children: "300 Hz" }), _jsx("span", { children: "400 Hz" }), _jsx("span", { children: "500 Hz" })] })] })] }) })), activeTab === 'DIAGNOSTICS' && (_jsx("div", { className: "space-y-4", children: _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "AI Incident Dossiers // Root Cause Synthesis" }), _jsx("div", { className: "text-xs text-zinc-500 font-mono", children: "Reasoning Matrix Grounded in SCADA Logs & Telemetry" })] }), _jsx("button", { onClick: triggerManualDiagnostics, disabled: aiAnalysisRunning, className: "px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 flex items-center gap-1.5", children: "Run New Inference Cycle" })] }), _jsx("div", { className: "space-y-4", children: findings.map((item) => (_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/60 p-4", children: [_jsxs("div", { className: "flex flex-wrap justify-between items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2.5 mb-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono font-bold text-xs bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-0.5", children: item.id }), _jsxs("span", { className: "font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300", children: ["TARGET: ", item.machineId] }), _jsxs("span", { className: "text-zinc-400 font-mono text-xs", children: ["| ", item.timestamp] })] }), _jsxs("div", { className: "flex items-center gap-2 text-xs font-mono", children: [_jsx("span", { className: "text-zinc-500", children: "CONFIDENCE:" }), _jsxs("span", { className: "font-bold text-blue-700 dark:text-blue-400", children: [Math.round(item.confidence * 100), "%"] }), _jsx("span", { className: "text-zinc-500 ml-2", children: "SEVERITY:" }), _jsx("span", { className: `font-bold px-1.5 py-0.5 text-[10px] ${item.severity === 'HIGH'
                                                                    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800'
                                                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'}`, children: item.severity })] })] }), _jsx("h3", { className: "text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2", children: item.title }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 mb-3", children: [_jsx("div", { className: "text-[10px] font-mono font-bold text-zinc-400 uppercase mb-1", children: "DETERMINED ROOT CAUSE MECHANISM:" }), _jsx("p", { className: "text-xs text-zinc-700 dark:text-zinc-300 font-sans leading-relaxed", children: item.rootCauseHypothesis })] }), _jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "text-[10px] font-mono font-bold text-zinc-500 uppercase mb-1.5", children: "CROSS-MODAL EVIDENCE CORROBORATION:" }), _jsx("ul", { className: "space-y-1", children: item.evidencePoints.map((ev, idx) => (_jsxs("li", { className: "text-xs font-mono text-zinc-600 dark:text-zinc-400 flex items-start gap-2", children: [_jsx("span", { className: "text-blue-600 dark:text-blue-400 font-bold", children: ">>" }), _jsx("span", { children: ev })] }, idx))) })] }), _jsxs("div", { className: "bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-500 p-2.5 mb-3 text-xs font-mono", children: [_jsx("span", { className: "font-bold text-amber-800 dark:text-amber-300 mr-2", children: "RECOMMENDED ACTION:" }), _jsx("span", { className: "text-zinc-800 dark:text-zinc-200", children: item.recommendedAction })] }), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs font-mono", children: [_jsxs("span", { className: "text-zinc-500", children: ["STATUS: ", _jsx("strong", { className: "text-zinc-800 dark:text-zinc-200", children: item.status.replace(/_/g, ' ') })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => {
                                                                    setFindings((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'TRIAGED' } : f));
                                                                }, className: "px-2.5 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-[11px]", children: "Acknowledge Triage" }), _jsx("button", { onClick: () => {
                                                                    alert(`[CMMS] Dispatching Priority Work Order to SAP Plant Maintenance for ${item.machineId}`);
                                                                    setFindings((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'DISPATCHED' } : f));
                                                                }, className: "px-2.5 py-1 bg-zinc-900 hover:bg-black text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 text-[11px] font-semibold border border-transparent", children: "Dispatch Work Order" })] })] })] }, item.id))) })] }) })), activeTab === 'LOGS' && (_jsx("div", { className: "space-y-4", children: _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm", children: [_jsxs("div", { className: "p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 text-xs font-mono", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-bold text-zinc-600 dark:text-zinc-400", children: "Filter Severity:" }), _jsx("div", { className: "flex gap-1", children: ['ALL', 'CRIT', 'WARN'].map((sev) => (_jsx("button", { onClick: () => setActiveFilterSeverity(sev), className: `px-2 py-0.5 text-[11px] border ${activeFilterSeverity === sev
                                                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 border-transparent font-bold'
                                                            : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'}`, children: sev }, sev))) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-zinc-500", children: "Search Logs:" }), _jsx("input", { type: "text", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), placeholder: "e.g. thermocouple, BPFO, 104...", className: "px-2 py-1 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-none w-56 focus:outline-none focus:border-blue-600" }), searchQuery && (_jsx("button", { onClick: () => setSearchQuery(''), className: "text-zinc-400 hover:text-zinc-600 text-xs", children: "CLEAR" }))] })] }), _jsx("div", { className: "overflow-x-auto max-h-[640px] overflow-y-auto", children: _jsxs("table", { className: "w-full text-left text-xs font-mono border-collapse", children: [_jsx("thead", { className: "sticky top-0 bg-zinc-100 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider", children: _jsxs("tr", { children: [_jsx("th", { className: "py-2 px-3 w-32", children: "Timestamp" }), _jsx("th", { className: "py-2 px-3 w-20", children: "Severity" }), _jsx("th", { className: "py-2 px-3 w-28", children: "MACHINE" }), _jsx("th", { className: "py-2 px-3 w-36", children: "SUBSYSTEM" }), _jsx("th", { className: "py-2 px-3", children: "Event Message" }), _jsx("th", { className: "py-2 px-3 w-48", children: "Metric Trigger" })] }) }), _jsx("tbody", { className: "divide-y divide-zinc-200 dark:divide-zinc-800", children: filteredLogs.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "py-8 text-center text-zinc-400 font-mono text-xs", children: "No log entries match the filter criteria." }) })) : (filteredLogs.map((log) => (_jsxs("tr", { className: `hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${log.level === 'CRIT'
                                                        ? 'bg-red-50/30 dark:bg-red-950/15'
                                                        : log.level === 'WARN'
                                                            ? 'bg-amber-50/20 dark:bg-amber-950/10'
                                                            : ''}`, children: [_jsx("td", { className: "py-2 px-3 text-zinc-500 text-[11px] whitespace-nowrap", children: log.timestamp }), _jsx("td", { className: "py-2 px-3", children: _jsx(LogLevelBadge, { level: log.level }) }), _jsx("td", { className: "py-2 px-3 font-semibold text-zinc-800 dark:text-zinc-200", children: log.machineId }), _jsx("td", { className: "py-2 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: log.subsystem.replace(/_/g, ' ') }), _jsx("td", { className: "py-2 px-3 text-zinc-900 dark:text-zinc-100", children: log.message }), _jsx("td", { className: "py-2 px-3 text-[11px] text-zinc-500 font-semibold", children: log.metricTrigger || '—' })] }, log.id)))) })] }) }), _jsxs("div", { className: "p-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[10px] font-mono text-zinc-500 flex justify-between", children: [_jsxs("span", { children: ["SHOWING ", filteredLogs.length, " OF ", logs.length, " BUFFERED SCADA RECORDS"] }), _jsx("span", { children: "Ring Buffer: Nominal (No Overflow)" })] })] }) }))] }), _jsx(IoConfigModal, { isOpen: showConfigModal, onClose: () => setShowConfigModal(false), wsEndpoint: wsEndpoint, setWsEndpoint: setWsEndpoint, streamActive: streamActive, isConnected: isConnected }), _jsxs("footer", { className: "border-t border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-[10px] font-mono text-zinc-500 flex flex-wrap justify-between items-center gap-2", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { children: "MachSight RC Car Monitor // Test Track Zone A" }), _jsx("span", { children: "PROTOCOL: WebSocket / FastAPI" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("span", { children: ["UTC Time: ", new Date().toISOString().replace('T', ' ').substring(0, 19)] }), _jsx("span", { className: isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400', "font-semibold": true, children: isConnected ? 'WebSocket Connected' : 'WebSocket Disconnected' })] })] })] }));
}
//# sourceMappingURL=IndustrialDoctor.js.map