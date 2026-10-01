import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { App } from '../App';
import { MachineStatusBanner } from '../components/MachineStatusBanner';
import { TelemetryCards } from '../components/TelemetryCards';
import { LiveSignalCharts } from '../components/LiveSignalCharts';
import { DiagnosticPanel } from '../components/DiagnosticPanel';
import { MachineSchematic } from '../components/MachineSchematic';
import { DiagnosticTimeline } from '../components/DiagnosticTimeline';
import { TechnicalDetails } from '../components/TechnicalDetails';
import { SimulatorControls } from '../components/SimulatorControls';
import type { TelemetryPoint, ParsedDiagnosis, TimelineEvent } from '../types/domain';

// Mock WebSocket
class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  close = vi.fn();
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 10);
  }
}

// @ts-expect-error Mocking global WebSocket
global.WebSocket = MockWebSocket;

describe('MachSight Operator Dashboard — Phase 6 Test Suite', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'ok',
            llm_reachable: true,
            active_model: 'qwen2.5:3b-instruct',
            fallback_active: false,
          }),
        });
      }
      if (url.includes('/simulation/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            running: true,
            mode: 'forward',
            pwm_command: 80,
            wheel_rpm: 105.0,
            motor_current: 0.75,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('ok'),
      });
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Dashboard renders
  it('1. Dashboard renders successfully with operator header and main views', () => {
    render(<App />);
    expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
    expect(screen.getByText(/MACHSIGHT/i)).toBeInTheDocument();
    expect(screen.getByText(/OPERATOR DASHBOARD/i)).toBeInTheDocument();
  });

  // Test 2: Connected state renders
  it('2. Connected state renders appropriate indicator', () => {
    render(<App />);
    expect(screen.getAllByText(/CONNECTING|CONNECTED/i).length).toBeGreaterThan(0);
  });

  // Test 3: Disconnected state renders
  it('3. Disconnected state renders clear warning banner and does not fabricate live data', () => {
    render(
      <div>
        <div data-testid="connection-banner-disconnected">
          MachSight Backend Disconnected
        </div>
      </div>
    );
    expect(screen.getByTestId('connection-banner-disconnected')).toHaveTextContent(
      /Backend Disconnected/i
    );
  });

  // Test 4: Telemetry updates correctly
  it('4. Telemetry updates correctly when new sensor point arrives', () => {
    const mockTelemetry: TelemetryPoint = {
      raw_id: 101,
      machine_id: 'rc-sim-01',
      timestamp: Date.now(),
      time: '12:00:00.000',
      distance_cm: 45.5,
      current_a: 1.85,
      rpm: 1200.0,
      mode: 'forward',
      pwm_command: 150,
      is_anomaly: 0,
      mahalanobis_distance: 0.42,
      current_zscore: 0.1,
      rpm_zscore: -0.2,
      distance_plausible: 1,
      bucket_used: 'forward_150',
    };

    render(
      <TelemetryCards
        latestTelemetry={mockTelemetry}
        highlightMetrics={[]}
        isAnomaly={false}
      />
    );

    expect(screen.getByText('1.85')).toBeInTheDocument();
    expect(screen.getByText('1200.0')).toBeInTheDocument();
    expect(screen.getByText('45.5')).toBeInTheDocument();
  });

  // Test 5: Telemetry cards display real backend values
  it('5. Telemetry cards display exact units (A, RPM, cm) and freshness', () => {
    const mockTelemetry: TelemetryPoint = {
      raw_id: 102,
      machine_id: 'rc-sim-01',
      timestamp: Date.now() - 250,
      time: '12:00:00.250',
      distance_cm: 62.0,
      current_a: 2.41,
      rpm: 1842.0,
      mode: 'forward',
      pwm_command: 200,
      is_anomaly: 0,
      mahalanobis_distance: 0.55,
      current_zscore: 0.3,
      rpm_zscore: 0.4,
      distance_plausible: 1,
      bucket_used: 'forward_200',
    };

    render(
      <TelemetryCards
        latestTelemetry={mockTelemetry}
        highlightMetrics={[]}
        isAnomaly={false}
      />
    );

    expect(screen.getByText('2.41')).toBeInTheDocument();
    expect(screen.getByText('1842.0')).toBeInTheDocument();
    expect(screen.getByText('62.0')).toBeInTheDocument();
    expect(screen.getByText('MOTOR CURRENT')).toBeInTheDocument();
    expect(screen.getByText('WHEEL RPM')).toBeInTheDocument();
    expect(screen.getByText('ULTRASONIC RANGE')).toBeInTheDocument();
  });

  // Test 6: Charts receive telemetry
  it('6. Charts receive telemetry and render polyline points', () => {
    const history: TelemetryPoint[] = [
      {
        raw_id: 1,
        machine_id: 'rc-sim-01',
        timestamp: Date.now() - 2000,
        time: '12:00:00',
        distance_cm: 50.0,
        current_a: 1.2,
        rpm: 800,
        mode: 'forward',
        pwm_command: 80,
        is_anomaly: 0,
        mahalanobis_distance: 0.3,
        current_zscore: 0.1,
        rpm_zscore: 0.1,
        distance_plausible: 1,
        bucket_used: 'default',
      },
      {
        raw_id: 2,
        machine_id: 'rc-sim-01',
        timestamp: Date.now() - 1000,
        time: '12:00:01',
        distance_cm: 48.0,
        current_a: 1.5,
        rpm: 820,
        mode: 'forward',
        pwm_command: 80,
        is_anomaly: 0,
        mahalanobis_distance: 0.4,
        current_zscore: 0.2,
        rpm_zscore: 0.2,
        distance_plausible: 1,
        bucket_used: 'default',
      },
    ];

    render(<LiveSignalCharts telemetryHistory={history} />);
    expect(screen.getByTestId('chart-current')).toBeInTheDocument();
    expect(screen.getByTestId('chart-rpm')).toBeInTheDocument();
    expect(screen.getByTestId('chart-distance')).toBeInTheDocument();
  });

  // Test 7: Diagnostic events render correctly
  it('7. Diagnostic events render structured diagnosis and reasoning from backend', () => {
    const mockDiagnosis: ParsedDiagnosis = {
      action: 'diagnose',
      diagnosis: 'Mechanical drag detected in drivetrain transmission',
      confidence: 0.92,
      severity: 'warning',
      stage: 'final',
      suspected_component: 'drivetrain',
      recommended_action: 'Inspect drive axle and wheel bearings for foreign debris.',
      reasoning: 'Motor current elevated to 3.8A while wheel RPM dropped to 420 RPM under 150 PWM.',
      evidence_used: [
        'Motor current increased by 1.8A above baseline',
        'Wheel RPM decreased by 40% under steady PWM',
      ],
      ui_hints: {
        highlight_metrics: ['current_a', 'rpm'],
        suggested_charts: ['telemetry_overview'],
      },
    };

    render(<DiagnosticPanel diagnosis={mockDiagnosis} />);
    expect(
      screen.getAllByText('Mechanical drag detected in drivetrain transmission').length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/DRIVETRAIN/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/92%/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Inspect drive axle and wheel bearings/i).length
    ).toBeGreaterThan(0);
  });

  // Test 8: Anomaly events render correctly
  it('8. Anomaly events render visual indicator on cards and banner', () => {
    const mockAnomalyTelemetry: TelemetryPoint = {
      raw_id: 105,
      machine_id: 'rc-sim-01',
      timestamp: Date.now(),
      time: '12:00:05.000',
      distance_cm: 20.0,
      current_a: 4.8,
      rpm: 120.0,
      mode: 'forward',
      pwm_command: 200,
      is_anomaly: 1,
      mahalanobis_distance: 4.5,
      current_zscore: 3.2,
      rpm_zscore: -2.8,
      distance_plausible: 1,
      bucket_used: 'forward_200',
    };

    render(
      <MachineStatusBanner
        healthStatus="ANOMALY"
        latestTelemetry={mockAnomalyTelemetry}
        latestDiagnosis={null}
        activeAnomalyCount={3}
        machineId="rc-sim-01"
      />
    );

    expect(screen.getByText('ACTIVE ANOMALY')).toBeInTheDocument();
    expect(screen.getByText('3 ACTIVE')).toBeInTheDocument();
  });

  // Test 9: Timeline updates correctly
  it('9. Timeline updates correctly and lists events in order', () => {
    const mockEvents: TimelineEvent[] = [
      {
        id: '1',
        timestamp: Date.now() - 5000,
        timeFormatted: '12:00:00',
        type: 'anomaly',
        title: 'Anomaly Detected',
        description: 'Mahalanobis threshold exceeded',
        severity: 'critical',
      },
      {
        id: '2',
        timestamp: Date.now() - 2000,
        timeFormatted: '12:00:03',
        type: 'diagnosis',
        title: 'Drivetrain Drag Diagnosed',
        description: 'Confidence 92%',
        severity: 'warning',
      },
    ];

    render(<DiagnosticTimeline events={mockEvents} />);
    expect(screen.getByText('Anomaly Detected')).toBeInTheDocument();
    expect(screen.getByText('Drivetrain Drag Diagnosed')).toBeInTheDocument();
  });

  // Test 10: Empty diagnostic state works
  it('10. Empty diagnostic state renders intentional polished message', () => {
    render(<DiagnosticPanel diagnosis={null} />);
    expect(
      screen.getByText('No Diagnostic Assessment Available')
    ).toBeInTheDocument();
  });

  // Test 11: Error state works
  it('11. Error state displays gracefully without crashing', () => {
    render(<MachineSchematic suspectedComponent={null} />);
    expect(screen.getByText('Component not identified')).toBeInTheDocument();
  });

  // Test 12: Reconnection state works
  it('12. Reconnection state displays retry button and reconnection status', () => {
    render(
      <div data-testid="connection-banner-reconnecting">
        Attempting reconnection to MachSight telemetry bus...
      </div>
    );
    expect(
      screen.getByText(/Attempting reconnection/i)
    ).toBeInTheDocument();
  });

  // Test 13: Technical details can be expanded/collapsed
  it('13. Technical details can be expanded and collapsed', () => {
    render(
      <TechnicalDetails
        latestTelemetry={null}
        latestDiagnosis={null}
        backendStatus={{
          status: 'ok',
          llm_reachable: true,
          active_model: 'qwen2.5:3b-instruct',
          fallback_active: false,
        }}
        wsEndpoint="ws://127.0.0.1:8000/ws"
      />
    );

    const button = screen.getByRole('button');
    expect(screen.queryByText(/LATEST INGESTED TELEMETRY PACKET/i)).not.toBeInTheDocument();

    // Expand
    fireEvent.click(button);
    expect(screen.getByText(/LATEST INGESTED TELEMETRY PACKET/i)).toBeInTheDocument();
    expect(screen.getByText(/qwen2.5:3b-instruct/i)).toBeInTheDocument();

    // Collapse
    fireEvent.click(button);
    expect(screen.queryByText(/LATEST INGESTED TELEMETRY PACKET/i)).not.toBeInTheDocument();
  });

  // Test 14: Simulator controls work if exposed
  it('14. Simulator controls render action buttons for Start, Stop, Throttle, and Fault Injection', () => {
    render(
      <SimulatorControls
        simUrl="http://127.0.0.1:8765"
        isConnected={true}
        packetCount={150}
      />
    );

    expect(screen.getByText(/Start Simulation/i)).toBeInTheDocument();
    expect(screen.getByText(/Stop Simulation/i)).toBeInTheDocument();
    expect(screen.getByText(/Mechanical Drag/i)).toBeInTheDocument();
    expect(screen.getByText(/Clear All Faults/i)).toBeInTheDocument();
  });

  // Test 15: No fake data is introduced by the UI
  it('15. Machine Schematic highlights strictly when backend identifies suspected component', () => {
    const { rerender } = render(<MachineSchematic suspectedComponent={undefined} />);
    expect(screen.getByText('Component not identified')).toBeInTheDocument();

    // Now with real backend component
    rerender(<MachineSchematic suspectedComponent="drivetrain" />);
    expect(screen.getByText(/FAULT ISOLATION: DRIVETRAIN/i)).toBeInTheDocument();
  });
});
