import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { MachineStatusBanner } from '../components/MachineStatusBanner';
import { TelemetryCards } from '../components/TelemetryCards';
import { LiveSignalCharts } from '../components/LiveSignalCharts';
import { DiagnosticPanel } from '../components/DiagnosticPanel';
import { MachineSchematic } from '../components/MachineSchematic';
import { DiagnosticTimeline } from '../components/DiagnosticTimeline';
import { DataQualityPanel } from '../components/DataQualityPanel';
import { TechnicalDetails } from '../components/TechnicalDetails';
export const PrimaryDashboard = ({ state }) => {
    return (_jsxs("div", { "data-testid": "primary-operator-dashboard", className: "space-y-4", children: [_jsx(MachineStatusBanner, { healthStatus: state.healthStatus, latestTelemetry: state.latestTelemetry, latestDiagnosis: state.latestDiagnosis, activeAnomalyCount: state.activeAnomalyCount, machineId: state.machineId }), _jsx(TelemetryCards, { latestTelemetry: state.latestTelemetry, highlightMetrics: state.highlightMetrics, isAnomaly: state.latestTelemetry?.is_anomaly === 1 }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-12 gap-4", children: [_jsx("div", { className: "lg:col-span-8", children: _jsx(LiveSignalCharts, { telemetryHistory: state.telemetryHistory }) }), _jsx("div", { className: "lg:col-span-4", children: _jsx(MachineSchematic, { suspectedComponent: state.latestDiagnosis?.suspected_component }) })] }), _jsx(DiagnosticPanel, { diagnosis: state.latestDiagnosis }), _jsx(DiagnosticTimeline, { events: state.timelineEvents }), _jsx(DataQualityPanel, { connectionState: state.connectionState, quality: state.qualityMetrics, backendStatus: state.backendStatus }), _jsx(TechnicalDetails, { latestTelemetry: state.latestTelemetry, latestDiagnosis: state.latestDiagnosis, backendStatus: state.backendStatus, wsEndpoint: state.wsEndpoint })] }));
};
//# sourceMappingURL=PrimaryDashboard.js.map