import React from 'react';
import type { UseMachSightReturn } from '../hooks/useMachSightWebSocket';
import { MachineStatusBanner } from '../components/MachineStatusBanner';
import { TelemetryCards } from '../components/TelemetryCards';
import { LiveSignalCharts } from '../components/LiveSignalCharts';
import { DiagnosticPanel } from '../components/DiagnosticPanel';
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
      {/* 1. Machine Status Banner */}
      <MachineStatusBanner
        healthStatus={state.healthStatus}
        latestTelemetry={state.latestTelemetry}
        latestDiagnosis={state.latestDiagnosis}
        activeAnomalyCount={state.activeAnomalyCount}
        machineId={state.machineId}
      />

      {/* 2. Live Telemetry Cards */}
      <TelemetryCards
        latestTelemetry={state.latestTelemetry}
        highlightMetrics={state.highlightMetrics}
        isAnomaly={state.latestTelemetry?.is_anomaly === 1}
      />

      {/* 3. Real-time Charts & Machine Subsystem Schematic Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Live Signal Charts (8 cols on desktop) */}
        <div className="lg:col-span-8">
          <LiveSignalCharts telemetryHistory={state.telemetryHistory} />
        </div>

        {/* Machine Schematic Topology (4 cols on desktop) */}
        <div className="lg:col-span-4">
          <MachineSchematic suspectedComponent={state.latestDiagnosis?.suspected_component} />
        </div>
      </div>

      {/* 4. Structured AI Diagnostic Panel & Explainability Trail */}
      <DiagnosticPanel diagnosis={state.latestDiagnosis} />

      {/* 5. Chronological Event Timeline */}
      <DiagnosticTimeline events={state.timelineEvents} />

      {/* 6. Sensor & Data Quality Metrics */}
      <DataQualityPanel
        connectionState={state.connectionState}
        quality={state.qualityMetrics}
        backendStatus={state.backendStatus}
      />

      {/* 7. Advanced Technical Details & Wire Payload Inspection */}
      <TechnicalDetails
        latestTelemetry={state.latestTelemetry}
        latestDiagnosis={state.latestDiagnosis}
        backendStatus={state.backendStatus}
        wsEndpoint={state.wsEndpoint}
      />
    </div>
  );
};
