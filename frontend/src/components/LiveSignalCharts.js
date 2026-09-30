import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { formatValue, formatTimestamp } from '../utils/formatters';
export const LiveSignalCharts = ({ telemetryHistory }) => {
    const [activeChannel, setActiveChannel] = useState('all');
    if (!telemetryHistory || telemetryHistory.length === 0) {
        return (_jsx("div", { "data-testid": "live-signal-charts", className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center", children: _jsx("div", { className: "font-mono text-xs text-zinc-500", children: "Waiting for telemetry stream to render live signal charts..." }) }));
    }
    // Rolling window of last 60 points
    const points = telemetryHistory.slice(-60);
    // SVG Chart Dimensions
    const width = 800;
    const height = 140;
    const padLeft = 45;
    const padRight = 15;
    const padTop = 15;
    const padBottom = 25;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const renderChannelSvg = (title, unit, color, getValue, testId) => {
        const validValues = points.map(getValue).filter((v) => v !== null && !isNaN(v));
        const minVal = validValues.length > 0 ? Math.min(...validValues) : 0;
        const maxVal = validValues.length > 0 ? Math.max(...validValues) : 1;
        const range = maxVal - minVal === 0 ? 1 : maxVal - minVal;
        // Build polyline points
        const polylinePoints = points
            .map((pt, i) => {
            const val = getValue(pt);
            if (val === null || isNaN(val))
                return null;
            const x = padLeft + (i / Math.max(1, points.length - 1)) * plotWidth;
            const y = padTop + plotHeight - ((val - minVal) / range) * plotHeight;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
            .filter(Boolean)
            .join(' ');
        // Extract anomaly zones (runs of points where is_anomaly === 1)
        const anomalyBands = [];
        let startIdx = null;
        points.forEach((pt, i) => {
            if (pt.is_anomaly === 1) {
                if (startIdx === null)
                    startIdx = i;
            }
            else {
                if (startIdx !== null) {
                    const xStart = padLeft + (startIdx / Math.max(1, points.length - 1)) * plotWidth;
                    const xEnd = padLeft + (i / Math.max(1, points.length - 1)) * plotWidth;
                    anomalyBands.push({ x: xStart, width: Math.max(2, xEnd - xStart) });
                    startIdx = null;
                }
            }
        });
        if (startIdx !== null) {
            const xStart = padLeft + (startIdx / Math.max(1, points.length - 1)) * plotWidth;
            const xEnd = padLeft + plotWidth;
            anomalyBands.push({ x: xStart, width: Math.max(2, xEnd - xStart) });
        }
        const latestPt = points[points.length - 1];
        const latestVal = latestPt ? getValue(latestPt) : null;
        const firstTime = points[0]?.timestamp ? formatTimestamp(points[0].timestamp) : '';
        const lastTime = latestPt?.timestamp ? formatTimestamp(latestPt.timestamp) : '';
        return (_jsxs("div", { "data-testid": testId, className: "border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "w-2.5 h-2.5 rounded-full", style: { backgroundColor: color } }), _jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase", children: title }), _jsxs("span", { className: "text-[10px] font-mono text-zinc-500", children: ["[", unit, "]"] })] }), _jsxs("div", { className: "font-mono text-xs font-bold", style: { color }, children: ["LIVE: ", formatValue(latestVal, 2), " ", unit] })] }), _jsxs("svg", { viewBox: `0 0 ${width} ${height}`, className: "w-full h-28 overflow-visible block", style: { shapeRendering: 'geometricPrecision' }, children: [anomalyBands.map((band, idx) => (_jsx("rect", { x: band.x, y: padTop, width: band.width, height: plotHeight, fill: "rgba(239, 68, 68, 0.15)", stroke: "rgba(239, 68, 68, 0.4)", strokeWidth: "0.5" }, `anomaly-band-${idx}`))), _jsx("line", { x1: padLeft, y1: padTop, x2: width - padRight, y2: padTop, stroke: "currentColor", strokeDasharray: "2 3", className: "text-zinc-300 dark:text-zinc-700 opacity-60", strokeWidth: "0.75" }), _jsx("line", { x1: padLeft, y1: padTop + plotHeight / 2, x2: width - padRight, y2: padTop + plotHeight / 2, stroke: "currentColor", strokeDasharray: "2 3", className: "text-zinc-300 dark:text-zinc-700 opacity-40", strokeWidth: "0.75" }), _jsx("line", { x1: padLeft, y1: padTop + plotHeight, x2: width - padRight, y2: padTop + plotHeight, stroke: "currentColor", className: "text-zinc-300 dark:text-zinc-700", strokeWidth: "1" }), _jsx("text", { x: padLeft - 6, y: padTop + 4, textAnchor: "end", className: "fill-zinc-500 font-mono text-[9px]", children: formatValue(maxVal, 1) }), _jsx("text", { x: padLeft - 6, y: padTop + plotHeight + 3, textAnchor: "end", className: "fill-zinc-500 font-mono text-[9px]", children: formatValue(minVal, 1) }), polylinePoints && (_jsx("polyline", { fill: "none", stroke: color, strokeWidth: "1.75", strokeLinecap: "round", strokeLinejoin: "round", points: polylinePoints })), latestVal !== null && (_jsx("circle", { cx: padLeft + plotWidth, cy: padTop + plotHeight - ((latestVal - minVal) / range) * plotHeight, r: "3.5", fill: color, stroke: "#ffffff", strokeWidth: "1" })), _jsx("text", { x: padLeft, y: height - 5, textAnchor: "start", className: "fill-zinc-400 font-mono text-[9px]", children: firstTime }), _jsxs("text", { x: width - padRight, y: height - 5, textAnchor: "end", className: "fill-zinc-400 font-mono text-[9px]", children: [lastTime, " (Latest)"] })] })] }));
    };
    return (_jsxs("div", { "data-testid": "live-signal-charts", className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4 space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide", children: "SYNCHRONIZED TELEMETRY SIGNALS // ROLLING WINDOW (60 SAMPLES)" }), _jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/30 rounded", children: "RED BANDS = ANOMALIES" })] }), _jsx("div", { className: "flex items-center gap-1 font-mono text-[11px]", children: [
                            { key: 'all', label: 'All Channels' },
                            { key: 'current', label: 'Current' },
                            { key: 'rpm', label: 'RPM' },
                            { key: 'distance', label: 'Distance' },
                        ].map((c) => (_jsx("button", { onClick: () => setActiveChannel(c.key), className: `px-2 py-0.5 border ${activeChannel === c.key
                                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold border-transparent'
                                : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`, children: c.label }, c.key))) })] }), _jsxs("div", { className: "grid grid-cols-1 gap-3", children: [(activeChannel === 'all' || activeChannel === 'current') &&
                        renderChannelSvg('Motor Current', 'A', '#2563eb', (pt) => pt.current_a, 'chart-current'), (activeChannel === 'all' || activeChannel === 'rpm') &&
                        renderChannelSvg('Wheel RPM', 'RPM', '#10b981', (pt) => pt.rpm, 'chart-rpm'), (activeChannel === 'all' || activeChannel === 'distance') &&
                        renderChannelSvg('Ultrasonic Distance', 'cm', '#a855f7', (pt) => pt.distance_cm, 'chart-distance')] })] }));
};
//# sourceMappingURL=LiveSignalCharts.js.map