import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { formatTimestamp } from '../utils/formatters';
export const Header = ({ activeTab, setActiveTab, connectionState, machineId, lastUpdateTimestamp, packetCount, darkMode, setDarkMode, onOpenConfig, onReconnect, }) => {
    const getConnectionBadge = () => {
        switch (connectionState) {
            case 'CONNECTED':
                return {
                    dot: 'bg-emerald-500',
                    text: 'CONNECTED',
                    badgeClass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
                };
            case 'CONNECTING':
                return {
                    dot: 'bg-blue-500 animate-pulse',
                    text: 'CONNECTING',
                    badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
                };
            case 'RECONNECTING':
                return {
                    dot: 'bg-amber-500 animate-pulse',
                    text: 'RECONNECTING',
                    badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
                };
            case 'DISCONNECTED':
            default:
                return {
                    dot: 'bg-zinc-500',
                    text: 'DISCONNECTED',
                    badgeClass: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
                };
        }
    };
    const conn = getConnectionBadge();
    return (_jsx("header", { "data-testid": "dashboard-header", className: "border-b border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-40 shadow-sm", children: _jsxs("div", { className: "max-w-[1920px] mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "w-3 h-3 rounded-none bg-blue-600 font-mono text-[9px] text-white flex items-center justify-center font-bold", children: "M" }), _jsx("span", { className: "font-mono text-sm font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100", children: "MACHSIGHT" }), _jsx("span", { className: "hidden sm:inline font-mono text-[10px] text-zinc-400 uppercase tracking-widest pl-1 border-l border-zinc-300 dark:border-zinc-700", children: "INDUSTRIAL DIAGNOSTICS" })] }), _jsxs("div", { className: "flex items-center gap-2 pl-3 border-l border-zinc-200 dark:border-zinc-800", children: [_jsxs("span", { className: `inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${conn.badgeClass}`, children: [_jsx("span", { className: `w-2 h-2 rounded-full ${conn.dot}` }), conn.text] }), connectionState === 'DISCONNECTED' && (_jsx("button", { onClick: onReconnect, className: "px-2 py-0.5 text-[10px] font-mono bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm", children: "RECONNECT" }))] }), _jsxs("div", { className: "hidden md:flex items-center gap-3 text-xs font-mono text-zinc-500 pl-3 border-l border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { children: ["MACHINE: ", _jsx("strong", { className: "text-zinc-800 dark:text-zinc-200", children: machineId || 'rc-sim-01' })] }), _jsxs("div", { children: ["SOURCE: ", _jsx("span", { className: "text-zinc-700 dark:text-zinc-300", children: "Simulator (8765)" })] }), _jsxs("div", { children: ["UPDATED:", ' ', _jsx("span", { className: "text-zinc-700 dark:text-zinc-300", children: lastUpdateTimestamp ? formatTimestamp(lastUpdateTimestamp) : '—' })] })] })] }), _jsx("nav", { className: "flex items-center gap-1 font-mono text-xs", children: [
                        { id: 'DASHBOARD', label: 'OPERATOR DASHBOARD' },
                        { id: 'OVERVIEW', label: 'TELEMETRY BUS' },
                        { id: 'DIAGNOSTICS', label: 'AI DIAGNOSTICS' },
                        { id: 'LOGS', label: 'EVENT LOGS' },
                        { id: 'SIMULATOR', label: 'SIMULATOR' },
                    ].map((tab) => (_jsx("button", { onClick: () => setActiveTab(tab.id), className: `px-3 py-1.5 font-semibold transition-colors ${activeTab === tab.id
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`, children: tab.label }, tab.id))) }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "hidden xl:flex items-center gap-2 text-[11px] font-mono text-zinc-500 mr-2", children: _jsxs("span", { children: ["PACKETS: ", packetCount.toLocaleString()] }) }), _jsx("button", { onClick: onOpenConfig, title: "Configure WebSocket / Endpoints", className: "p-1.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700", children: _jsxs("svg", { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [_jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })] }) }), _jsx("button", { onClick: () => setDarkMode(!darkMode), title: "Toggle Dark / Light Theme", className: "p-1.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs", children: darkMode ? '☀ LIGHT' : '🌙 DARK' })] })] }) }));
};
//# sourceMappingURL=Header.js.map