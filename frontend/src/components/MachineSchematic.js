import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
export const MachineSchematic = ({ suspectedComponent }) => {
    const compRaw = typeof suspectedComponent === 'object' && suspectedComponent !== null
        ? (suspectedComponent.display_name || suspectedComponent.component_id || '')
        : (suspectedComponent || '');
    const comp = compRaw.toLowerCase().trim();
    const isMotorSuspected = comp.includes('motor');
    const isDrivetrainSuspected = comp.includes('drivetrain') || comp.includes('transmission') || comp.includes('gear');
    const isWheelsSuspected = comp.includes('wheel') || comp.includes('bearing') || comp.includes('tire');
    const isUltrasonicSuspected = comp.includes('ultrasonic') || comp.includes('sensor') || comp.includes('range');
    const isBatterySuspected = comp.includes('battery') || comp.includes('power') || comp.includes('voltage');
    const isControllerSuspected = comp.includes('controller') || comp.includes('esc') || comp.includes('pwm');
    const getHighlightClass = (isSuspected) => {
        if (isSuspected) {
            return {
                fill: '#ef4444',
                fillOpacity: 0.35,
                stroke: '#dc2626',
                strokeWidth: 2.5,
                filter: 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.6))',
            };
        }
        return {
            fill: 'currentColor',
            fillOpacity: 0.08,
            stroke: 'currentColor',
            strokeWidth: 1.25,
            filter: 'none',
        };
    };
    return (_jsxs("div", { "data-testid": "machine-schematic", className: "border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide", children: "VEHICLE SUBSYSTEM TOPOLOGY SCHEMATIC" }), _jsx("span", { className: "text-[10px] font-mono text-zinc-500", children: "RC-01 / CAR-PROTO-01" })] }), _jsx("div", { className: "font-mono text-[11px]", children: suspectedComponent ? (_jsxs("span", { className: "px-2 py-0.5 font-bold bg-red-500/20 text-red-400 border border-red-500/40 rounded animate-pulse", children: ["FAULT ISOLATION: ", comp.toUpperCase()] })) : (_jsx("span", { className: "text-zinc-400 text-xs", children: "Component not identified" })) })] }), _jsxs("div", { className: "flex flex-col lg:flex-row items-center justify-around gap-6 py-2", children: [_jsx("div", { className: "relative w-full max-w-md", children: _jsxs("svg", { viewBox: "0 0 400 240", className: "w-full h-auto text-zinc-400 dark:text-zinc-600 block", style: { shapeRendering: 'geometricPrecision' }, children: [_jsx("rect", { x: "90", y: "40", width: "220", height: "160", rx: "16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeDasharray: "4 3", className: "text-zinc-300 dark:text-zinc-700" }), _jsxs("g", { children: [_jsx("rect", { x: "310", y: "85", width: "30", height: "70", rx: "4", style: getHighlightClass(isUltrasonicSuspected) }), _jsx("circle", { cx: "325", cy: "105", r: "7", style: getHighlightClass(isUltrasonicSuspected) }), _jsx("circle", { cx: "325", cy: "135", r: "7", style: getHighlightClass(isUltrasonicSuspected) }), _jsx("text", { x: "350", y: "125", className: "fill-zinc-500 font-mono text-[10px]", textAnchor: "start", children: "Ultrasonic (SIG-01)" })] }), _jsx("rect", { x: "260", y: "15", width: "45", height: "20", rx: "3", style: getHighlightClass(isWheelsSuspected) }), _jsx("rect", { x: "260", y: "205", width: "45", height: "20", rx: "3", style: getHighlightClass(isWheelsSuspected) }), _jsx("rect", { x: "95", y: "15", width: "45", height: "20", rx: "3", style: getHighlightClass(isWheelsSuspected) }), _jsx("rect", { x: "95", y: "205", width: "45", height: "20", rx: "3", style: getHighlightClass(isWheelsSuspected) }), _jsx("line", { x1: "282", y1: "35", x2: "282", y2: "205", stroke: "currentColor", strokeWidth: "2" }), _jsx("line", { x1: "117", y1: "35", x2: "117", y2: "205", stroke: "currentColor", strokeWidth: "2" }), _jsxs("g", { children: [_jsx("rect", { x: "150", y: "110", width: "100", height: "20", rx: "2", style: getHighlightClass(isDrivetrainSuspected) }), _jsx("text", { x: "200", y: "124", className: "fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold", textAnchor: "middle", children: "DRIVETRAIN" })] }), _jsxs("g", { children: [_jsx("rect", { x: "110", y: "95", width: "40", height: "50", rx: "4", style: getHighlightClass(isMotorSuspected) }), _jsx("text", { x: "130", y: "124", className: "fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold", textAnchor: "middle", children: "MOTOR" })] }), _jsxs("g", { children: [_jsx("rect", { x: "160", y: "55", width: "80", height: "45", rx: "4", style: getHighlightClass(isBatterySuspected) }), _jsx("text", { x: "200", y: "81", className: "fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold", textAnchor: "middle", children: "BATTERY" })] }), _jsxs("g", { children: [_jsx("rect", { x: "160", y: "140", width: "80", height: "45", rx: "4", style: getHighlightClass(isControllerSuspected) }), _jsx("text", { x: "200", y: "166", className: "fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold", textAnchor: "middle", children: "ESC / MCU" })] })] }) }), _jsxs("div", { className: "w-full lg:w-64 space-y-2 font-mono text-xs", children: [_jsx("div", { className: "text-[10px] text-zinc-500 uppercase font-bold mb-2", children: "Subsystem Status Legend" }), [
                                { name: 'Drivetrain Transmission', isSuspected: isDrivetrainSuspected, tag: 'DRV-01' },
                                { name: 'DC Drive Motor', isSuspected: isMotorSuspected, tag: 'MTR-01' },
                                { name: 'Ultrasonic Array', isSuspected: isUltrasonicSuspected, tag: 'SIG-01' },
                                { name: 'Wheel & Bearings', isSuspected: isWheelsSuspected, tag: 'WHL-04' },
                                { name: 'Battery / Power Pack', isSuspected: isBatterySuspected, tag: 'PWR-01' },
                                { name: 'Electronic Speed Controller', isSuspected: isControllerSuspected, tag: 'ESC-01' },
                            ].map((sub) => (_jsxs("div", { className: `flex items-center justify-between p-1.5 border rounded-none transition-colors ${sub.isSuspected
                                    ? 'border-red-500 bg-red-50/20 text-red-500 dark:text-red-400 font-bold'
                                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 bg-zinc-50/40 dark:bg-zinc-950/20'}`, children: [_jsxs("div", { className: "flex items-center gap-1.5 truncate", children: [_jsx("span", { className: `w-2 h-2 rounded-full ${sub.isSuspected ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}` }), _jsx("span", { className: "truncate", children: sub.name })] }), _jsx("span", { className: "text-[10px] shrink-0 font-bold", children: sub.isSuspected ? 'SUSPECT' : 'NOMINAL' })] }, sub.name)))] })] })] }));
};
//# sourceMappingURL=MachineSchematic.js.map