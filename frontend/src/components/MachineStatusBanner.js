import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { formatTimeAgo } from '../utils/formatters';
export const MachineStatusBanner = ({ healthStatus, latestTelemetry, latestDiagnosis, activeAnomalyCount, machineId, }) => {
    const getStatusConfig = () => {
        switch (healthStatus) {
            case 'HEALTHY':
                return {
                    label: 'NOMINAL HEALTH',
                    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
                    dotClass: 'bg-emerald-500',
                    desc: 'All telemetry metrics and ratios operating within nominal statistical baselines.',
                };
            case 'ATTENTION':
                return {
                    label: 'ATTENTION REQUIRED',
                    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
                    dotClass: 'bg-amber-400 animate-pulse',
                    desc: 'Telemetry trend deviation detected. Monitoring correlation closely.',
                };
            case 'ANOMALY':
                return {
                    label: 'ACTIVE ANOMALY',
                    badgeClass: 'bg-red-500/20 text-red-300 border-red-500/50 shadow-sm',
                    dotClass: 'bg-red-500 animate-ping',
                    desc: 'Multivariate statistical anomaly detected (Mahalanobis distance threshold exceeded).',
                };
            case 'SENSOR_ISSUE':
                return {
                    label: 'SENSOR ISSUE',
                    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
                    dotClass: 'bg-purple-400 animate-pulse',
                    desc: 'Sensor signal implausible, stuck, or dropped from expected operating envelope.',
                };
            case 'UNKNOWN':
            default:
                return {
                    label: 'STANDBY / UNKNOWN',
                    badgeClass: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
                    dotClass: 'bg-zinc-500',
                    desc: 'Waiting for continuous telemetry stream from backend.',
                };
        }
    };
    const config = getStatusConfig();
    const timeAgoText = latestTelemetry ? formatTimeAgo(latestTelemetry.timestamp) : 'No data';
    return (_jsx("div", { "data-testid": "machine-status-banner", className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4", children: _jsxs("div", { className: "flex flex-col lg:flex-row lg:items-center justify-between gap-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "relative flex items-center justify-center", children: _jsx("span", { className: `w-3.5 h-3.5 rounded-full ${config.dotClass}` }) }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `px-2.5 py-0.5 text-xs font-mono font-bold tracking-wider rounded border ${config.badgeClass}`, children: config.label }), _jsxs("span", { className: "font-mono text-xs text-zinc-500", children: ["// UNIT: ", _jsx("strong", { className: "text-zinc-800 dark:text-zinc-200", children: machineId || 'rc-sim-01' })] })] }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl", children: latestDiagnosis?.diagnosis || config.desc })] })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 pt-3 lg:pt-0 lg:pl-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-zinc-500 uppercase", children: "Operating Mode" }), _jsx("div", { className: "font-bold text-zinc-900 dark:text-zinc-100 uppercase mt-0.5", children: latestTelemetry?.mode || 'IDLE' }), _jsxs("div", { className: "text-[10px] text-zinc-400", children: ["PWM ", latestTelemetry?.pwm_command ?? 0] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-zinc-500 uppercase", children: "Active Anomalies" }), _jsx("div", { className: `font-bold mt-0.5 ${activeAnomalyCount > 0 ? 'text-red-500' : 'text-emerald-500'}`, children: activeAnomalyCount > 0 ? `${activeAnomalyCount} ACTIVE` : '0 (NONE)' }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Window Count" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-zinc-500 uppercase", children: "Latest Diagnosis" }), _jsx("div", { className: "font-bold text-zinc-900 dark:text-zinc-100 truncate mt-0.5 max-w-[120px]", title: latestDiagnosis?.diagnosis || 'Nominal', children: latestDiagnosis?.diagnosis ? (latestDiagnosis.stage === 'final' ? 'FINAL' : 'PRELIM') : 'NOMINAL' }), _jsx("div", { className: "text-[10px] text-zinc-400", children: latestDiagnosis?.suspected_component
                                        ? (typeof latestDiagnosis.suspected_component === 'object'
                                            ? (latestDiagnosis.suspected_component.display_name || latestDiagnosis.suspected_component.component_id || '').toUpperCase()
                                            : latestDiagnosis.suspected_component.toUpperCase())
                                        : 'NO FAULT' })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-zinc-500 uppercase", children: "Last Packet" }), _jsx("div", { className: "font-bold text-zinc-900 dark:text-zinc-100 mt-0.5", children: timeAgoText }), _jsx("div", { className: "text-[10px] text-zinc-400", children: "Freshness" })] })] })] }) }));
};
//# sourceMappingURL=MachineStatusBanner.js.map