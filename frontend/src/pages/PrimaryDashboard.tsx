import React from 'react';
import type { UseMachSightReturn } from '../hooks/useMachSightWebSocket';
import { MachineStatusBanner } from '../components/MachineStatusBanner';
import { DemoControlsBanner } from '../components/DemoControlsBanner';
import { DiagnosticPanel } from '../components/DiagnosticPanel';
import { TelemetryCards } from '../components/TelemetryCards';
import { LiveSignalCharts } from '../components/LiveSignalCharts';
import { MachineSchematic } from '../components/MachineSchematic';
import { DiagnosticTimeline } from '../components/DiagnosticTimeline';
import { DataQualityPanel } from '../components/DataQualityPanel';
import { TechnicalDetails } from '../components/TechnicalDetails';

interface Props {
  readonly state: UseMachSightReturn;
}

export const PrimaryDashboard: React.FC<Props> = ({ state }) => {
  return (
    <div data-testid="primary-operator-dashboard" className="space-y-4">
      {/* 0. Demo Operator Scenario Trigger Bar */}
      <DemoControlsBanner isConnected={state.connectionState === 'CONNECTED'} />

      {/* 1. Primary Machine Status Area */}
      <MachineStatusBanner
        healthStatus={state.healthStatus}
        latestTelemetry={state.latestTelemetry}
        latestDiagnosis={state.latestDiagnosis}
        activeAnomalyCount={state.activeAnomalyCount}
        machineId={state.machineId}
      />

      {/* 2. Structured AI Diagnostic Console (Most Important: Diagnosis -> Why -> What Changed -> Alternatives -> Actions -> Uncertainty) */}
      <DiagnosticPanel
        diagnosis={state.latestDiagnosis}
        healthStatus={state.healthStatus}
        latestTelemetry={state.latestTelemetry}
      />

      {/* 3. Calm Live Telemetry Cards (Supporting View) */}
      <TelemetryCards
        latestTelemetry={state.latestTelemetry}
        highlightMetrics={state.highlightMetrics}
        isAnomaly={state.latestTelemetry?.is_anomaly === 1}
      />

      {/* 4. Temporal Signal Trends & Subsystem Topology */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Synchronized Causal Trend Charts (8 cols) */}
        <div className="lg:col-span-8">
          <LiveSignalCharts telemetryHistory={state.telemetryHistory} />
        </div>

        {/* Machine Schematic Topology (4 cols) */}
        <div className="lg:col-span-4">
          <MachineSchematic suspectedComponent={state.latestDiagnosis?.suspected_component} />
        </div>
      </div>

      {/* 5. Chronological Diagnostic Event Timeline */}
      <DiagnosticTimeline events={state.timelineEvents} />

      {/* 6. Sensor Quality & Calibration Metrics */}
      <DataQualityPanel
        connectionState={state.connectionState}
        quality={state.qualityMetrics}
        backendStatus={state.backendStatus}
      />

      {/* 7. Technical Details & Wire Inspection (Collapsible at bottom) */}
      <TechnicalDetails
        latestTelemetry={state.latestTelemetry}
        latestDiagnosis={state.latestDiagnosis}
        backendStatus={state.backendStatus}
        wsEndpoint={state.wsEndpoint}
      />
    </div>
  );
};
