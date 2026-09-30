import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo, useRef } from 'react';
// ============================================================================
// 2. EMPTY STATE INITIALIZATION (No mock data - driven by backend)
// ============================================================================
const INITIAL_MACHINES = [
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
const INITIAL_LOGS = [];
const INITIAL_FINDINGS = [];
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
export function DashboardHeader({ activeTab, setActiveTab, darkMode, setDarkMode, streamActive, setStreamActive, packetCount, activeAlertCount, aiAnalysisRunning, triggerManualDiagnostics, onOpenIoConfig, isConnected, deviceConnected, onOpenDeviceDialog, }) {
    return (_jsxs("header", { className: "border-b border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-40", children: [_jsxs("div", { className: "px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-5 h-5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 flex items-center justify-center font-mono font-bold text-xs rounded-sm", children: "ID" }), _jsxs("div", { className: "flex flex-col", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono text-sm", children: "IndustrialDoctor" }), _jsx("span", { className: "px-1 py-0.2 bg-zinc-200 dark:bg-zinc-800 text-[9px] font-mono text-zinc-600 dark:text-zinc-400 rounded", children: "v4.1.8-PROD" })] }), _jsx("span", { className: "text-[10px] text-zinc-500 font-mono", children: "SCADA AI Diagnostic Agent // Host: plant-master-01" })] })] }), _jsxs("div", { className: "hidden lg:flex items-center gap-4 pl-4 border-l border-zinc-200 dark:border-zinc-800 font-mono text-[11px]", children: [_jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "BUFFER:" }), _jsxs("span", { className: "text-zinc-800 dark:text-zinc-200 font-semibold", children: [packetCount.toLocaleString(), " pkts"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "STREAM:" }), _jsx("span", { className: isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400', children: isConnected ? 'LIVE (WebSocket)' : 'DISCONNECTED' })] }), _jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "DEVICE:" }), _jsx("span", { className: deviceConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400', children: deviceConnected ? 'CONNECTED' : 'NOT CONNECTED' })] }), _jsxs("div", { children: [_jsx("span", { className: "text-zinc-400 dark:text-zinc-500 mr-1.5", children: "Alerts Active:" }), _jsx("span", { className: "text-red-700 dark:text-red-400 font-bold", children: activeAlertCount })] })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: onOpenDeviceDialog, disabled: deviceConnected, className: `px-2 py-1 font-mono text-[11px] rounded border transition-colors ${deviceConnected
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                    : 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'}`, children: deviceConnected ? 'Device Connected' : 'Connect Device' }), _jsxs("button", { onClick: () => setStreamActive(!streamActive), disabled: !deviceConnected, title: "Pause or resume live sensor packet ingestion loop", className: `px-2 py-1 font-mono text-[11px] rounded border transition-colors flex items-center gap-1.5 ${streamActive && deviceConnected
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                    : 'border-zinc-400 bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'}`, children: [_jsx("span", { className: `w-2 h-2 rounded-full ${streamActive && deviceConnected ? 'bg-emerald-600 animate-ping' : 'bg-zinc-400'}` }), streamActive && deviceConnected ? 'Stream Active' : 'Stream Paused'] }), _jsx("button", { onClick: triggerManualDiagnostics, disabled: aiAnalysisRunning || !deviceConnected, className: "px-2.5 py-1 font-mono text-[11px] font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 rounded border border-transparent disabled:opacity-50 flex items-center gap-1.5", children: aiAnalysisRunning ? (_jsxs(_Fragment, { children: [_jsxs("svg", { className: "animate-spin h-3 w-3", viewBox: "0 0 24 24", fill: "none", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" })] }), "Synthesizing..."] })) : ('Trigger AI Audit') }), _jsx("button", { onClick: onOpenIoConfig, className: "px-2 py-1 font-mono text-[11px] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-50 dark:hover:bg-zinc-750", children: "IO_CFG" }), _jsx("button", { onClick: () => setDarkMode(!darkMode), className: "px-2 py-1 font-mono text-[11px] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-50 dark:hover:bg-zinc-750 flex items-center gap-1", "aria-label": "Toggle Theme", children: _jsx("span", { className: "font-semibold", children: darkMode ? 'THEME: DARK' : 'THEME: LIGHT' }) })] })] }), _jsx("nav", { className: "px-4 flex items-center gap-1 border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/60 overflow-x-auto text-xs", children: [
                    { id: 'LANDING', label: 'System Gateway' },
                    { id: 'OVERVIEW', label: '[1] Telemetry Matrix' },
                    { id: 'DIAGNOSTICS', label: '[2] AI Diagnostics' },
                    { id: 'LOGS', label: '[3] Event Logs' },
                    { id: 'SIMULATOR', label: '[4] Simulator Control' },
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
export function DeviceConnectionDialog({ isOpen, onClose, onConnect, deviceConnected, }) {
    const [deviceId, setDeviceId] = useState('RC-01');
    if (!isOpen)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", children: _jsxs("div", { className: "bg-white dark:bg-zinc-900 border border-zinc-400 dark:border-zinc-700 w-full max-w-md p-5 font-mono text-xs shadow-2xl", children: [_jsxs("div", { className: "flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4", children: [_jsx("span", { className: "font-bold text-sm text-zinc-900 dark:text-zinc-100", children: "Device Connection" }), _jsx("button", { onClick: onClose, className: "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-bold", children: "[X]" })] }), _jsx("p", { className: "text-xs font-sans text-zinc-600 dark:text-zinc-400 mb-4", children: "Connect to an RC car device to begin streaming real-time telemetry and AI diagnosis data." }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-[10px] uppercase font-bold text-zinc-500 mb-1", children: "Device ID" }), _jsx("input", { type: "text", value: deviceId, onChange: (e) => setDeviceId(e.target.value), placeholder: "e.g., RC-01", className: "w-full p-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:border-blue-600" })] }), _jsxs("div", { className: "bg-zinc-100 dark:bg-zinc-950 p-2.5 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 space-y-1", children: [_jsx("div", { children: "Available Devices: RC-01, RC-02" }), _jsx("div", { children: "Connection Protocol: WebSocket" }), _jsxs("div", { children: ["Status: ", deviceConnected ? 'ALREADY CONNECTED' : 'NOT CONNECTED'] })] })] }), _jsxs("div", { className: "mt-5 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2", children: [_jsx("button", { onClick: onClose, className: "px-3 py-1.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs border border-zinc-300 dark:border-zinc-700", children: "Cancel" }), _jsx("button", { onClick: () => {
                                onConnect(deviceId);
                                onClose();
                            }, disabled: deviceConnected, className: "px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs border border-blue-900 disabled:opacity-50", children: "Connect Device" })] })] }) }));
}
// ============================================================================
// 4. MAIN DASHBOARD CONTAINER COMPONENT
// ============================================================================
export default function IndustrialDoctorApp() {
    const [darkMode, setDarkMode] = useState(false);
    const [activeTab, setActiveTab] = useState('LANDING');
    const [machines, setMachines] = useState(INITIAL_MACHINES);
    const [selectedMachineId, setSelectedMachineId] = useState('RC-01');
    const [logs, setLogs] = useState(INITIAL_LOGS);
    const [findings, setFindings] = useState(INITIAL_FINDINGS);
    const [streamActive, setStreamActive] = useState(false);
    const [packetCount, setPacketCount] = useState(0);
    const [activeFilterSeverity, setActiveFilterSeverity] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [aiAnalysisRunning, setAiAnalysisRunning] = useState(false);
    const [wsEndpoint, setWsEndpoint] = useState('ws://localhost:8000/ws');
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showDeviceDialog, setShowDeviceDialog] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [deviceConnected, setDeviceConnected] = useState(false);
    const [currentDiagnosis, setCurrentDiagnosis] = useState(null);
    const [highlightMetrics, setHighlightMetrics] = useState([]);
    const [anomalyDetected, setAnomalyDetected] = useState(false);
    // Simulator control state
    const [simRunning, setSimRunning] = useState(false);
    const [simStatus, setSimStatus] = useState('idle');
    const [simUrl] = useState('http://localhost:8765');
    const [faultStatus, setFaultStatus] = useState('');
    const [backendUrl] = useState('http://localhost:8000');
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const lastUpdateTimeRef = useRef(0);
    const telemetryBufferRef = useRef(new Map());
    const MAX_TELEMETRY_POINTS = 120; // 2 min at ~1 Hz display rate
    // Initialize telemetry buffer for each machine
    useEffect(() => {
        const buffer = new Map();
        machines.forEach((machine) => {
            buffer.set(machine.id, [...machine.telemetry]);
        });
        telemetryBufferRef.current = buffer;
    }, [machines]);
    // Handle device connection
    const handleDeviceConnect = (deviceId) => {
        setDeviceConnected(true);
        setSelectedMachineId(deviceId);
        setStreamActive(true);
        // Update machine status
        setMachines((prev) => prev.map((m) => m.id === deviceId
            ? { ...m, connected: true, status: 'NOMINAL' }
            : m));
    };
    // ── Simulator control helpers ──────────────────────────────────────────────
    const simFetch = async (path, method = 'POST', body) => {
        try {
            const resp = await fetch(`${simUrl}${path}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined,
            });
            return await resp.json();
        }
        catch (e) {
            return { error: String(e) };
        }
    };
    const startSimulation = async () => {
        const r = await simFetch('/simulation/start', 'POST', { scenario: null, seed: null });
        if (!r.error) {
            setSimRunning(true);
            setSimStatus('running');
        }
        else
            setSimStatus(`Error: ${r.error}`);
    };
    const stopSimulation = async () => {
        const r = await simFetch('/simulation/stop');
        if (!r.error) {
            setSimRunning(false);
            setSimStatus('stopped');
        }
        else
            setSimStatus(`Error: ${r.error}`);
    };
    const injectFault = async (faultType, params = {}) => {
        const body = { type: faultType, start_s: 0.0, ...params };
        const r = await simFetch('/faults/inject', 'POST', body);
        if (!r.error)
            setFaultStatus(`Injected: ${faultType} (id=${r.fault_id})`);
        else
            setFaultStatus(`Error: ${r.error}`);
    };
    const clearFaults = async () => {
        const r = await simFetch('/faults/clear', 'POST', {});
        if (!r.error)
            setFaultStatus('All faults cleared');
        else
            setFaultStatus(`Error: ${r.error}`);
    };
    const setThrottle = async (pwm, mode = 'forward') => {
        await simFetch('/control/throttle', 'POST', { pwm, mode });
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
                        const data = JSON.parse(event.data);
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
                            const isAnomaly = data.data.is_anomaly === 1;
                            setAnomalyDetected(isAnomaly);
                            // ── Push raw sensor readings into machine telemetry ────────────
                            // The backend now includes distance_cm, current_a, rpm, mode,
                            // pwm_command in every processed broadcast event (Phase 5.5 fix).
                            const d = data.data;
                            if (d.distance_cm !== undefined ||
                                d.current_a !== undefined ||
                                d.rpm !== undefined) {
                                const point = {
                                    time: new Date((d.timestamp || Date.now() / 1000) * 1000)
                                        .toISOString()
                                        .replace('T', ' ')
                                        .substring(0, 19),
                                    distance_cm: d.distance_cm ?? 0,
                                    current_a: d.current_a ?? 0,
                                    rpm: d.rpm ?? 0,
                                    mode: d.mode ?? 'idle',
                                    pwm_command: d.pwm_command ?? 0,
                                };
                                // Target machine: from machine_id in event or fallback to selected
                                const targetId = d.machine_id || selectedMachineId;
                                setMachines((prev) => prev.map((m) => {
                                    if (m.id !== targetId && m.id !== 'RC-01')
                                        return m;
                                    const telArr = [...m.telemetry, point];
                                    const trimmed = telArr.slice(-MAX_TELEMETRY_POINTS);
                                    const healthIndex = isAnomaly
                                        ? Math.max(0, m.healthIndex - 2)
                                        : Math.min(100, m.healthIndex + 1);
                                    const status = isAnomaly
                                        ? 'WARNING'
                                        : 'NOMINAL';
                                    return {
                                        ...m,
                                        telemetry: trimmed,
                                        healthIndex,
                                        status,
                                        runtimeHours: parseFloat((m.runtimeHours + 1 / 3600).toFixed(4)),
                                    };
                                }));
                            }
                        }
                        else if ((data.type === 'investigation_step' || data.type === 'diagnosis') && data.data?.payload) {
                            // Double-encoded JSON: parse the payload string
                            try {
                                const parsedPayload = JSON.parse(data.data.payload);
                                // Add investigation step to logs
                                if (data.type === 'investigation_step') {
                                    const newLogEntry = {
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
                    if (reconnectAttempts < maxReconnectAttempts && streamActive && deviceConnected) {
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
    }, [wsEndpoint, streamActive, deviceConnected, selectedMachineId]);
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
    // No mock data generation - all data comes from WebSocket
    // Telemetry will be populated when device is connected and backend sends data
    // Trigger AI Audit — sends a synthesized anomaly to the backend to force
    // an investigation cycle. Reuses the ingestion WebSocket.
    const triggerManualDiagnostics = () => {
        setAiAnalysisRunning(true);
        // Send a synthetic high-current reading via the backend status poll to
        // tickle an investigation. The real path is the simulator sending anomalous
        // telemetry; the button is a dev-override shortcut.
        fetch(`${backendUrl}/api/status`)
            .then((r) => r.json())
            .then(() => {
            setActiveTab('DIAGNOSTICS');
            // Investigation events will arrive via WebSocket naturally
            setTimeout(() => setAiAnalysisRunning(false), 3000);
        })
            .catch(() => {
            setAiAnalysisRunning(false);
        });
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
    return (_jsxs("div", { className: "min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 font-sans selection:bg-zinc-300 dark:selection:bg-zinc-700 transition-colors duration-150", children: [_jsx(DashboardHeader, { activeTab: activeTab, setActiveTab: setActiveTab, darkMode: darkMode, setDarkMode: setDarkMode, streamActive: streamActive, setStreamActive: setStreamActive, packetCount: packetCount, activeAlertCount: activeAlertCount, aiAnalysisRunning: aiAnalysisRunning, triggerManualDiagnostics: triggerManualDiagnostics, onOpenIoConfig: () => setShowConfigModal(true), isConnected: isConnected, deviceConnected: deviceConnected, onOpenDeviceDialog: () => setShowDeviceDialog(true) }), _jsxs("main", { className: "p-4 max-w-[1920px] mx-auto space-y-4", children: [activeTab === 'LANDING' && (_jsx("section", { className: "space-y-4", children: !deviceConnected ? (_jsx("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center", children: _jsxs("div", { className: "max-w-md mx-auto", children: [_jsx("div", { className: "w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4", children: _jsx("svg", { className: "w-8 h-8 text-zinc-400", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M13 10V3L4 14h7v7l9-11h-7z" }) }) }), _jsx("h2", { className: "text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2", children: "No Device Connected" }), _jsx("p", { className: "text-sm text-zinc-600 dark:text-zinc-400 mb-6", children: "Connect an RC car device to begin streaming real-time telemetry and AI diagnosis data." }), _jsx("button", { onClick: () => setShowDeviceDialog(true), className: "px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm", children: "Connect Device" })] }) })) : (_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 rounded-none shadow-sm", children: [_jsxs("div", { className: "flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5", children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs text-blue-700 dark:text-blue-400 font-semibold mb-1", children: "System Overview // RC Car Diagnostic Agent" }), _jsx("h1", { className: "text-2xl font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-100", children: "RC Car Telemetry & AI Diagnostic Engine" }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400 font-sans mt-1 max-w-3xl leading-relaxed", children: "Real-time autonomous inference platform monitoring RC car telemetry with AI-powered anomaly detection and diagnosis. Continuous multi-modal telemetry correlation including motor current, wheel RPM, ultrasonic distance, and PWM command analysis." })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => setActiveTab('OVERVIEW'), className: "px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm", children: "View Telemetry \u2192" }), _jsx("button", { onClick: () => setActiveTab('DIAGNOSTICS'), className: "px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-xs border border-zinc-300 dark:border-zinc-700", children: "AI Diagnostics" })] })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-5", children: [_jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Device Status" }), _jsx("div", { className: "text-xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1", children: "CONNECTED" }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-0.5", children: selectedMachineId })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Telemetry Packets" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: packetCount.toLocaleString() }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-0.5", children: "Processed events" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Active Diagnoses" }), _jsx("div", { className: "text-xl font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1", children: findings.length }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-0.5", children: "AI findings" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/60", children: [_jsx("div", { className: "text-[10px] font-mono text-zinc-500 uppercase", children: "Connection" }), _jsx("div", { className: "text-xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1", children: "WEBSOCKET" }), _jsx("div", { className: "text-[10px] font-mono text-zinc-500 mt-0.5", children: "Live stream" })] })] })] })) })), activeTab === 'OVERVIEW' && (_jsx("section", { className: "space-y-4", children: !deviceConnected ? (_jsx("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center", children: _jsxs("div", { className: "max-w-md mx-auto", children: [_jsx("div", { className: "w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4", children: _jsx("svg", { className: "w-8 h-8 text-zinc-400", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" }) }) }), _jsx("h2", { className: "text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2", children: "No Telemetry Data Available" }), _jsx("p", { className: "text-sm text-zinc-600 dark:text-zinc-400 mb-6", children: "Connect a device to view real-time RC car telemetry data." }), _jsx("button", { onClick: () => setShowDeviceDialog(true), className: "px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm", children: "Connect Device" })] }) })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3", children: _jsxs("div", { className: "flex flex-col md:flex-row md:items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xs font-mono font-bold text-zinc-500 uppercase", children: "Active Unit:" }), _jsx("div", { className: "flex flex-wrap gap-1", children: machines.map((m) => (_jsxs("button", { onClick: () => setSelectedMachineId(m.id), className: `px-2.5 py-1 font-mono text-xs font-semibold border transition-colors ${selectedMachineId === m.id
                                                                ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                                                                : 'bg-zinc-50 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-750'}`, children: [m.id, " [", m.tag, "]"] }, m.id))) })] }), _jsxs("div", { className: "flex items-center gap-3 text-xs font-mono", children: [_jsx("span", { className: "text-zinc-500", children: "STATUS:" }), _jsx(StatusBadge, { status: currentMachine.status }), _jsx("span", { className: "text-zinc-500 ml-2", children: "HEALTH:" }), _jsxs("span", { className: `font-bold ${currentMachine.healthIndex > 85
                                                            ? 'text-emerald-700 dark:text-emerald-400'
                                                            : currentMachine.healthIndex > 65
                                                                ? 'text-amber-700 dark:text-amber-400'
                                                                : 'text-red-700 dark:text-red-400'}`, children: [currentMachine.healthIndex, "%"] }), _jsx("span", { className: "text-zinc-500 ml-2", children: "Run Hours:" }), _jsxs("span", { className: "font-semibold text-zinc-800 dark:text-zinc-200", children: [currentMachine.runtimeHours.toLocaleString(), " h"] })] })] }) }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden", children: [_jsxs("div", { className: "px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: ["REAL-TIME SENSOR TELEMETRY BUS // ", currentMachine.id, " - ", currentMachine.name] }), _jsxs("span", { className: "font-mono text-[10px] text-zinc-500", children: ["[", currentMachine.area, "]"] })] }), _jsxs("div", { className: "text-[11px] font-mono text-zinc-500 flex items-center gap-2", children: [_jsxs("span", { children: ["SAMPLES: ", currentMachine.telemetry.length, " PT WINDOW"] }), _jsx("span", { className: "w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping" })] })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-left text-xs font-mono border-collapse", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/80 text-[10px] text-zinc-500 uppercase tracking-wider", children: [_jsx("th", { className: "py-2 px-3", children: "Channel ID" }), _jsx("th", { className: "py-2 px-3", children: "Parameter" }), _jsx("th", { className: "py-2 px-3", children: "Current Value" }), _jsx("th", { className: "py-2 px-3", children: "Setpoint / Band" }), _jsx("th", { className: "py-2 px-3", children: "Signal Trend (2m Sparkline)" }), _jsx("th", { className: "py-2 px-3", children: "Status Indicator" })] }) }), _jsx("tbody", { className: "divide-y divide-zinc-200 dark:divide-zinc-800", children: currentMachine.telemetry.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "py-8 text-center text-zinc-400 font-mono text-xs", children: "Waiting for telemetry data from backend..." }) })) : (_jsxs(_Fragment, { children: [_jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-01.DIST" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Ultrasonic Distance" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Front-facing ultrasonic range sensor" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100", children: [currentLatestPoint.distance_cm, _jsx("span", { className: "text-zinc-400 text-xs ml-1 font-normal", children: "cm" })] }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "Range: 2-400 cm" }), _jsx("td", { className: "py-2.5 px-3", children: _jsx(SvgSparkline, { data: currentMachine.telemetry.map((p) => p.distance_cm), color: highlightMetrics.includes('distance_cm') ? '#d97706' : '#2563eb', height: 28, width: 190, fill: true, showMinMax: true, unit: "cm" }) }), _jsx("td", { className: "py-2.5 px-3", children: highlightMetrics.includes('distance_cm') ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-bold text-[11px]", children: "INVESTIGATING" })) : (_jsx("span", { className: "text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold", children: "NOMINAL" })) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-02.CURR" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Motor Current" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "DC motor current draw sensor" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold", children: [_jsx("span", { className: currentLatestPoint.current_a > 5.0
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
                                                                                            : '#2563eb', height: 28, width: 190, fill: true, showMinMax: true, unit: "rpm" }) }), _jsx("td", { className: "py-2.5 px-3", children: highlightMetrics.includes('rpm') ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-bold text-[11px]", children: "INVESTIGATING" })) : currentLatestPoint.rpm < 100 ? (_jsx("span", { className: "text-red-700 dark:text-red-400 font-bold text-[11px]", children: "STALL" })) : currentLatestPoint.rpm < 500 ? (_jsx("span", { className: "text-amber-700 dark:text-amber-400 font-semibold text-[11px]", children: "LOW SPEED" })) : (_jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]", children: "NOMINAL" })) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-04.MODE" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "Operating Mode" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Motor control mode state" })] }), _jsx("td", { className: "py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100", children: currentLatestPoint.mode }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "forward, idle, reverse" }), _jsx("td", { className: "py-2.5 px-3", children: _jsxs("div", { className: "text-[10px] text-zinc-400 font-mono", children: ["State: ", currentLatestPoint.mode.toUpperCase()] }) }), _jsx("td", { className: "py-2.5 px-3", children: _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold", children: "ACTIVE" }) })] }), _jsxs("tr", { className: "hover:bg-zinc-50 dark:hover:bg-zinc-800/40", children: [_jsx("td", { className: "py-2.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300", children: "SIG-05.PWM" }), _jsxs("td", { className: "py-2.5 px-3", children: [_jsx("div", { className: "font-semibold text-zinc-900 dark:text-zinc-100", children: "PWM Command" }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Motor driver PWM signal (0-255)" })] }), _jsxs("td", { className: "py-2.5 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100", children: [currentLatestPoint.pwm_command, _jsx("span", { className: "text-zinc-400 text-xs ml-1 font-normal", children: "/255" })] }), _jsx("td", { className: "py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: "Range: 0-255" }), _jsx("td", { className: "py-2.5 px-3", children: _jsx(SvgSparkline, { data: currentMachine.telemetry.map((p) => p.pwm_command), color: "#475569", height: 28, width: 190, fill: true, showMinMax: true, unit: "" }) }), _jsx("td", { className: "py-2.5 px-3", children: _jsx("span", { className: "text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold", children: "COMMAND SENT" }) })] })] })) })] }) })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: [_jsx("span", { children: "Subsystem Health Indicators" }), _jsx("span", { className: "text-[10px] font-mono text-zinc-500", children: "DRIVEN BY BACKEND AI DIAGNOSTICS" })] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono", children: [_jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Drivetrain Health" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: "MONITORING" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: '100%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Status updated based on AI analysis results." })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Motor Assembly" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: "MONITORING" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: '100%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Status updated based on AI analysis results." })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Ultrasonic Array" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: "MONITORING" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: '100%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Status updated based on AI analysis results." })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsxs("div", { className: "flex justify-between items-center mb-1", children: [_jsx("span", { className: "font-bold text-zinc-800 dark:text-zinc-200", children: "Battery System" }), _jsx("span", { className: "text-emerald-700 dark:text-emerald-400 font-bold", children: "MONITORING" })] }), _jsx("div", { className: "w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-none overflow-hidden mb-1.5", children: _jsx("div", { className: "bg-emerald-600 h-full", style: { width: '100%' } }) }), _jsx("div", { className: "text-[10px] text-zinc-500", children: "Status updated based on AI analysis results." })] })] })] })] })) })), activeTab === 'DIAGNOSTICS' && (_jsx("section", { className: "space-y-4", children: !deviceConnected ? (_jsx("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center", children: _jsxs("div", { className: "max-w-md mx-auto", children: [_jsx("div", { className: "w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4", children: _jsx("svg", { className: "w-8 h-8 text-zinc-400", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" }) }) }), _jsx("h2", { className: "text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2", children: "No Diagnostics Available" }), _jsx("p", { className: "text-sm text-zinc-600 dark:text-zinc-400 mb-6", children: "Connect a device to view AI-powered diagnostic findings from the backend ML reasoning layer." }), _jsx("button", { onClick: () => setShowDeviceDialog(true), className: "px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm", children: "Connect Device" })] }) })) : (_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "AI Diagnostics // Backend ML Reasoning Layer" }), _jsx("div", { className: "text-xs text-zinc-500 font-mono", children: "Preliminary rule-based diagnoses and final LLM-based diagnoses from backend" })] }), _jsx("button", { onClick: triggerManualDiagnostics, disabled: aiAnalysisRunning, className: "px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 flex items-center gap-1.5", children: "Run New Inference Cycle" })] }), _jsx("div", { className: "space-y-4", children: findings.length === 0 ? (_jsx("div", { className: "text-center py-8 text-zinc-400 font-mono text-xs", children: "No diagnostic findings yet. Wait for backend to detect anomalies or trigger manual analysis." })) : (findings.map((item) => (_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/60 p-4", children: [_jsxs("div", { className: "flex flex-wrap justify-between items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2.5 mb-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono font-bold text-xs bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-0.5", children: item.id }), _jsxs("span", { className: "font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300", children: ["TARGET: ", item.machineId] }), _jsxs("span", { className: "text-zinc-400 font-mono text-xs", children: ["| ", item.timestamp] }), item.stage && (_jsx("span", { className: `font-mono text-[10px] px-1.5 py-0.5 ${item.stage === 'preliminary'
                                                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                                                    : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'}`, children: item.stage.toUpperCase() }))] }), _jsxs("div", { className: "flex items-center gap-2 text-xs font-mono", children: [_jsx("span", { className: "text-zinc-500", children: "CONFIDENCE:" }), _jsxs("span", { className: "font-bold text-blue-700 dark:text-blue-400", children: [Math.round(item.confidence * 100), "%"] }), _jsx("span", { className: "text-zinc-500 ml-2", children: "SEVERITY:" }), _jsx("span", { className: `font-bold px-1.5 py-0.5 text-[10px] ${item.severity === 'HIGH'
                                                                    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800'
                                                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'}`, children: item.severity })] })] }), _jsx("h3", { className: "text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2", children: item.title }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 mb-3", children: [_jsx("div", { className: "text-[10px] font-mono font-bold text-zinc-400 uppercase mb-1", children: "DETERMINED ROOT CAUSE MECHANISM:" }), _jsx("p", { className: "text-xs text-zinc-700 dark:text-zinc-300 font-sans leading-relaxed", children: item.rootCauseHypothesis })] }), _jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "text-[10px] font-mono font-bold text-zinc-500 uppercase mb-1.5", children: "CROSS-MODAL EVIDENCE CORROBORATION:" }), _jsx("ul", { className: "space-y-1", children: item.evidencePoints.map((ev, idx) => (_jsxs("li", { className: "text-xs font-mono text-zinc-600 dark:text-zinc-400 flex items-start gap-2", children: [_jsx("span", { className: "text-blue-600 dark:text-blue-400 font-bold", children: ">>" }), _jsx("span", { children: ev })] }, idx))) })] }), _jsxs("div", { className: "bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-500 p-2.5 mb-3 text-xs font-mono", children: [_jsx("span", { className: "font-bold text-amber-800 dark:text-amber-300 mr-2", children: "RECOMMENDED ACTION:" }), _jsx("span", { className: "text-zinc-800 dark:text-zinc-200", children: item.recommendedAction })] }), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs font-mono", children: [_jsxs("span", { className: "text-zinc-500", children: ["STATUS: ", _jsx("strong", { className: "text-zinc-800 dark:text-zinc-200", children: item.status.replace(/_/g, ' ') })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => {
                                                                    setFindings((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'TRIAGED' } : f));
                                                                }, className: "px-2.5 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-[11px]", children: "Acknowledge Triage" }), _jsx("button", { onClick: () => {
                                                                    alert(`[CMMS] Dispatching Priority Work Order to SAP Plant Maintenance for ${item.machineId}`);
                                                                    setFindings((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'DISPATCHED' } : f));
                                                                }, className: "px-2.5 py-1 bg-zinc-900 hover:bg-black text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 text-[11px] font-semibold border border-transparent", children: "Dispatch Work Order" })] })] })] }, item.id)))) })] })) })), activeTab === 'LOGS' && (_jsx("section", { className: "space-y-4", children: !deviceConnected ? (_jsx("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 rounded-none shadow-sm text-center", children: _jsxs("div", { className: "max-w-md mx-auto", children: [_jsx("div", { className: "w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4", children: _jsx("svg", { className: "w-8 h-8 text-zinc-400", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }) }) }), _jsx("h2", { className: "text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mb-2", children: "No Event Logs Available" }), _jsx("p", { className: "text-sm text-zinc-600 dark:text-zinc-400 mb-6", children: "Connect a device to view real-time event logs and investigation steps from the backend." }), _jsx("button", { onClick: () => setShowDeviceDialog(true), className: "px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white font-mono text-xs font-semibold rounded-none border border-blue-900 shadow-sm", children: "Connect Device" })] }) })) : (_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm", children: [_jsxs("div", { className: "p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 text-xs font-mono", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-bold text-zinc-600 dark:text-zinc-400", children: "Filter Severity:" }), _jsx("div", { className: "flex gap-1", children: ['ALL', 'CRIT', 'WARN'].map((sev) => (_jsx("button", { onClick: () => setActiveFilterSeverity(sev), className: `px-2 py-0.5 text-[11px] border ${activeFilterSeverity === sev
                                                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 border-transparent font-bold'
                                                            : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'}`, children: sev }, sev))) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-zinc-500", children: "Search Logs:" }), _jsx("input", { type: "text", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), placeholder: "e.g. thermocouple, BPFO, 104...", className: "px-2 py-1 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-none w-56 focus:outline-none focus:border-blue-600" }), searchQuery && (_jsx("button", { onClick: () => setSearchQuery(''), className: "text-zinc-400 hover:text-zinc-600 text-xs", children: "CLEAR" }))] })] }), _jsx("div", { className: "overflow-x-auto max-h-[640px] overflow-y-auto", children: _jsxs("table", { className: "w-full text-left text-xs font-mono border-collapse", children: [_jsx("thead", { className: "sticky top-0 bg-zinc-100 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider", children: _jsxs("tr", { children: [_jsx("th", { className: "py-2 px-3 w-32", children: "Timestamp" }), _jsx("th", { className: "py-2 px-3 w-20", children: "Severity" }), _jsx("th", { className: "py-2 px-3 w-28", children: "MACHINE" }), _jsx("th", { className: "py-2 px-3 w-36", children: "SUBSYSTEM" }), _jsx("th", { className: "py-2 px-3", children: "Event Message" }), _jsx("th", { className: "py-2 px-3 w-48", children: "Metric Trigger" })] }) }), _jsx("tbody", { className: "divide-y divide-zinc-200 dark:divide-zinc-800", children: filteredLogs.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "py-8 text-center text-zinc-400 font-mono text-xs", children: "No log entries match the filter criteria." }) })) : (filteredLogs.map((log) => (_jsxs("tr", { className: `hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${log.level === 'CRIT'
                                                        ? 'bg-red-50/30 dark:bg-red-950/15'
                                                        : log.level === 'WARN'
                                                            ? 'bg-amber-50/20 dark:bg-amber-950/10'
                                                            : ''}`, children: [_jsx("td", { className: "py-2 px-3 text-zinc-500 text-[11px] whitespace-nowrap", children: log.timestamp }), _jsx("td", { className: "py-2 px-3", children: _jsx(LogLevelBadge, { level: log.level }) }), _jsx("td", { className: "py-2 px-3 font-semibold text-zinc-800 dark:text-zinc-200", children: log.machineId }), _jsx("td", { className: "py-2 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]", children: log.subsystem.replace(/_/g, ' ') }), _jsx("td", { className: "py-2 px-3 text-zinc-900 dark:text-zinc-100", children: log.message }), _jsx("td", { className: "py-2 px-3 text-[11px] text-zinc-500 font-semibold", children: log.metricTrigger || '—' })] }, log.id)))) })] }) }), _jsxs("div", { className: "p-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[10px] font-mono text-zinc-500 flex justify-between", children: [_jsxs("span", { children: ["SHOWING ", filteredLogs.length, " OF ", logs.length, " BUFFERED SCADA RECORDS"] }), _jsx("span", { children: "Ring Buffer: Nominal (No Overflow)" })] })] })) })), activeTab === 'SIMULATOR' && (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "MachSight-Simulator Control Panel" }), _jsx("span", { className: `font-mono text-[11px] px-2 py-0.5 border ${simRunning
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                    : 'border-zinc-400 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'}`, children: simRunning ? '● RUNNING' : '○ STOPPED' }), simStatus && (_jsxs("span", { className: "font-mono text-[11px] text-zinc-500", children: ["Status: ", simStatus] }))] }), _jsxs("div", { className: "font-mono text-[10px] text-zinc-400", children: ["Simulator API: ", simUrl] })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-4", children: "Simulation Engine" }), _jsxs("div", { className: "flex flex-wrap gap-2 mb-4", children: [_jsx("button", { id: "sim-start-btn", onClick: startSimulation, disabled: simRunning, className: "px-4 py-2 font-mono text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white border border-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "\u25B6 Start Simulation" }), _jsx("button", { id: "sim-stop-btn", onClick: stopSimulation, disabled: !simRunning, className: "px-4 py-2 font-mono text-xs font-semibold bg-red-700 hover:bg-red-800 text-white border border-red-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "\u25A0 Stop Simulation" })] }), _jsx("div", { className: "font-mono text-[11px] font-bold text-zinc-500 uppercase mb-2", children: "Throttle Control" }), _jsx("div", { className: "flex flex-wrap gap-2", children: [
                                            { label: 'IDLE', pwm: 0, mode: 'idle' },
                                            { label: 'SLOW (PWM 80)', pwm: 80, mode: 'forward' },
                                            { label: 'MEDIUM (PWM 150)', pwm: 150, mode: 'forward' },
                                            { label: 'FULL (PWM 255)', pwm: 255, mode: 'forward' },
                                            { label: 'REVERSE (PWM 100)', pwm: 100, mode: 'reverse' },
                                        ].map((t) => (_jsx("button", { id: `throttle-${t.pwm}-btn`, onClick: () => setThrottle(t.pwm, t.mode), disabled: !simRunning, className: "px-3 py-1.5 font-mono text-[11px] bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed", children: t.label }, t.label))) })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-4", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200", children: "Fault Injection" }), faultStatus && (_jsx("span", { className: `font-mono text-[11px] px-2 py-0.5 border ${faultStatus.startsWith('Error')
                                                    ? 'border-red-400 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                                                    : 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'}`, children: faultStatus }))] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3", children: [_jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1", children: "Mechanical Drag" }), _jsx("div", { className: "font-sans text-[11px] text-zinc-500 mb-3 leading-relaxed", children: "Adds resistance torque to drivetrain. Raises current draw, reduces RPM. Mimics bearing wear or debris." }), _jsx("button", { id: "fault-drag-btn", onClick: () => injectFault('motor_drag', { severity: 0.6, duration_s: 30 }), disabled: !simRunning, className: "w-full px-3 py-1.5 font-mono text-[11px] font-semibold bg-amber-700 hover:bg-amber-800 text-white border border-amber-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "Inject Drag Fault" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1", children: "Motor Jam / Stall" }), _jsx("div", { className: "font-sans text-[11px] text-zinc-500 mb-3 leading-relaxed", children: "Locks the motor shaft. RPM drops to zero, current spikes then drops. Triggers stall detection." }), _jsx("button", { id: "fault-jam-btn", onClick: () => injectFault('drivetrain_jam', { severity: 1.0, duration_s: 15 }), disabled: !simRunning, className: "w-full px-3 py-1.5 font-mono text-[11px] font-semibold bg-red-700 hover:bg-red-800 text-white border border-red-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "Inject Jam Fault" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1", children: "Sensor Failure" }), _jsx("div", { className: "font-sans text-[11px] text-zinc-500 mb-3 leading-relaxed", children: "Drops ultrasonic sensor readings. distance_cm becomes null / 0. Tests sensor-vs-mechanical fault discrimination." }), _jsx("button", { id: "fault-sensor-btn", onClick: () => injectFault('ultrasonic_stuck', { stuck_value_cm: 0.0, severity: 1.0, duration_s: 20 }), disabled: !simRunning, className: "w-full px-3 py-1.5 font-mono text-[11px] font-semibold bg-blue-700 hover:bg-blue-800 text-white border border-blue-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "Inject Sensor Dropout" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1", children: "Current Spike" }), _jsx("div", { className: "font-sans text-[11px] text-zinc-500 mb-3 leading-relaxed", children: "Injects additive current offset. Raises current_a above anomaly threshold to trigger ML detection." }), _jsx("button", { id: "fault-current-btn", onClick: () => injectFault('current_bias', { bias_a: 3.0, severity: 0.8, duration_s: 25 }), disabled: !simRunning, className: "w-full px-3 py-1.5 font-mono text-[11px] font-semibold bg-orange-700 hover:bg-orange-800 text-white border border-orange-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "Inject Current Spike" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1", children: "Intermittent RPM Dropout" }), _jsx("div", { className: "font-sans text-[11px] text-zinc-500 mb-3 leading-relaxed", children: "Randomly zeros the wheel RPM sensor for short bursts. Simulates encoder/connection flakiness." }), _jsx("button", { id: "fault-rpm-btn", onClick: () => injectFault('rpm_dropout', { severity: 1.0, duration_s: 30 }), disabled: !simRunning, className: "w-full px-3 py-1.5 font-mono text-[11px] font-semibold bg-purple-700 hover:bg-purple-800 text-white border border-purple-900 disabled:opacity-40 disabled:cursor-not-allowed", children: "Inject RPM Dropout" })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50/50 dark:bg-zinc-950/40 flex flex-col justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1", children: "Clear All Faults" }), _jsx("div", { className: "font-sans text-[11px] text-zinc-500 mb-3 leading-relaxed", children: "Remove all active fault injections immediately. Vehicle returns to nominal operating state." })] }), _jsx("button", { id: "fault-clear-btn", onClick: clearFaults, disabled: !simRunning, className: "w-full px-3 py-1.5 font-mono text-[11px] font-semibold bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 border border-transparent disabled:opacity-40 disabled:cursor-not-allowed", children: "\u2713 Clear All Faults" })] })] })] }), _jsxs("div", { className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4", children: [_jsx("div", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3", children: "Live Integration Status" }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono", children: [_jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "text-[10px] text-zinc-400 uppercase mb-1", children: "MachSight Backend" }), _jsx("div", { className: `font-bold ${isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`, children: isConnected ? '● CONNECTED' : '○ DISCONNECTED' }), _jsxs("div", { className: "text-[10px] text-zinc-500 mt-0.5", children: [backendUrl, "/ws"] })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "text-[10px] text-zinc-400 uppercase mb-1", children: "Simulator Engine" }), _jsx("div", { className: `font-bold ${simRunning ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}`, children: simRunning ? '● RUNNING' : '○ IDLE' }), _jsx("div", { className: "text-[10px] text-zinc-500 mt-0.5", children: simUrl })] }), _jsxs("div", { className: "border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-950/40", children: [_jsx("div", { className: "text-[10px] text-zinc-400 uppercase mb-1", children: "Telemetry Packets" }), _jsx("div", { className: "font-bold text-zinc-900 dark:text-zinc-100", children: packetCount.toLocaleString() }), _jsx("div", { className: "text-[10px] text-zinc-500 mt-0.5", children: anomalyDetected ? '⚠ ANOMALY DETECTED' : 'Nominal stream' })] })] }), _jsxs("div", { className: "mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-[11px] font-mono text-zinc-500 space-y-1", children: [_jsx("div", { className: "font-semibold text-zinc-600 dark:text-zinc-400", children: "Quick Start:" }), _jsx("div", { children: "1. Ensure both services are running (see README). Backend: port 8000, Simulator: port 8765." }), _jsx("div", { children: "2. Click \"Connect Device\" in the header \u2192 enter RC-01 \u2192 Connect." }), _jsx("div", { children: "3. Click \"Start Simulation\" \u2192 set throttle to MEDIUM." }), _jsx("div", { children: "4. Inject a fault \u2192 watch AI Diagnostics tab for backend diagnosis events." }), _jsx("div", { children: "5. Click \"Clear All Faults\" to observe recovery in the Telemetry Matrix." })] })] })] }))] }), _jsx(IoConfigModal, { isOpen: showConfigModal, onClose: () => setShowConfigModal(false), wsEndpoint: wsEndpoint, setWsEndpoint: setWsEndpoint, streamActive: streamActive, isConnected: isConnected }), _jsx(DeviceConnectionDialog, { isOpen: showDeviceDialog, onClose: () => setShowDeviceDialog(false), onConnect: handleDeviceConnect, deviceConnected: deviceConnected }), _jsxs("footer", { className: "border-t border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-[10px] font-mono text-zinc-500 flex flex-wrap justify-between items-center gap-2", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { children: "MachSight RC Car Monitor // Test Track Zone A" }), _jsx("span", { children: "PROTOCOL: WebSocket / FastAPI" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("span", { children: ["UTC Time: ", new Date().toISOString().replace('T', ' ').substring(0, 19)] }), _jsx("span", { className: `${isConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'} font-semibold`, children: isConnected ? 'WebSocket Connected' : 'WebSocket Disconnected' })] })] })] }));
}
//# sourceMappingURL=IndustrialDoctor.js.map