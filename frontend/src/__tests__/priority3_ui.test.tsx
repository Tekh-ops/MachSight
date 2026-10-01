import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MachineStatusBanner } from '../components/MachineStatusBanner';
import { DiagnosticPanel } from '../components/DiagnosticPanel';
import { WhatChangedSection } from '../components/WhatChangedSection';
import { WhySection } from '../components/WhySection';
import { AlternativeHypothesesSection } from '../components/AlternativeHypothesesSection';
import { RecommendedActionsSection } from '../components/RecommendedActionsSection';
import { UncertaintySection } from '../components/UncertaintySection';
import { RecoveryCard } from '../components/RecoveryCard';
import type { ParsedDiagnosis, TelemetryPoint } from '../types/domain';

describe('MachSight Priority 3 — Trustworthy Diagnostic UI States', () => {
  const mockHealthyTelemetry: TelemetryPoint = {
    time: '10:42:00',
    timestamp: 1727768520000,
    distance_cm: 85.0,
    current_a: 1.62,
    rpm: 224.0,
    velocity_mps: 0.81,
    mode: 'forward',
    pwm_command: 200,
    is_anomaly: 0,
    mahalanobis_distance: 1.2,
    current_zscore: 0.1,
    rpm_zscore: -0.1,
    distance_plausible: 1,
    bucket_used: 'forward:200',
    raw_id: 1,
    machine_id: 'car-01',
  };

  const mockJamDiagnosis: ParsedDiagnosis = {
    action: 'diagnose',
    diagnosis: 'Possible drivetrain obstruction',
    confidence: 0.92,
    severity: 'critical',
    stage: 'final',
    fallback_active: false,
    machine_id: 'car-01',
    primary_hypothesis: {
      id: 'DRIVETRAIN_OBSTRUCTION',
      label: 'Possible drivetrain obstruction',
      description: 'Elevated motor current without corresponding wheel RPM under sustained throttle command indicates excessive mechanical resistance.',
      diagnostic_score: 0.92,
      affected_subsystem: 'Drivetrain / Transmission',
      supporting_evidence_ids: ['E001', 'E002', 'E003', 'E004'],
      matched_supporting_patterns: ['elevated_current_rpm_ratio', 'persistent_condition', 'reduced_rpm_at_normal_command'],
    },
    alternative_hypotheses: [
      {
        id: 'MOTOR_OVERLOAD',
        label: 'Motor Thermal Overload',
        description: 'Excessive current draw causing thermal stress on motor windings.',
        diagnostic_score: 0.61,
        affected_subsystem: 'Electromagnetic Motor',
        supporting_evidence_ids: ['E001'],
        matched_supporting_patterns: ['elevated_current'],
        matched_contradicting_patterns: ['velocity_dropped_toward_zero'],
      },
      {
        id: 'RPM_SENSOR_FAILURE',
        label: 'Wheel Speed / RPM Sensor Failure',
        description: 'Sensor reporting collapsed RPM despite normal shaft rotation.',
        diagnostic_score: 0.28,
        affected_subsystem: 'Telemetry Sensors',
        supporting_evidence_ids: ['E002'],
        matched_supporting_patterns: ['rpm_collapsed'],
        matched_contradicting_patterns: ['motor_current_elevated_148pct', 'vehicle_velocity_decreased'],
      },
    ],
    what_changed: [
      { metric: 'Motor Command', baseline: 'Forward Cruise', current: 'PWM 200 (Sustained)', change: 'sustained high', status: 'nominal' },
      { metric: 'Motor Current', baseline: '1.60 A', current: '3.96 A', change: '+148%', status: 'elevated' },
      { metric: 'Wheel RPM', baseline: '225 RPM', current: '22 RPM', change: '-90%', status: 'collapsed' },
      { metric: 'Vehicle Motion', baseline: '0.80 m/s', current: '0.08 m/s', change: '-90%', status: 'stalled' },
      { metric: 'Condition Persistence', baseline: 'Transient noise', current: 'Persistent', change: 'Window 3.5s', status: 'concerning' },
    ],
    evidence: [
      { id: 'E001', type: 'observed_behavior', description: 'Motor current elevated to 3.96 A (+148% above baseline)', source: 'current_sensor', value: 3.96, baseline: 1.60, change_pct: 147.5, confidence: 0.95, supports: ['DRIVETRAIN_OBSTRUCTION'], contradicts: ['RPM_SENSOR_FAILURE'] },
      { id: 'E002', type: 'observed_behavior', description: 'Wheel RPM collapsed to 22 RPM (-90% drop from expected)', source: 'rpm_sensor', value: 22.0, baseline: 225.0, change_pct: -90.2, confidence: 0.95, supports: ['DRIVETRAIN_OBSTRUCTION', 'RPM_SENSOR_FAILURE'], contradicts: [] },
      { id: 'E003', type: 'derived_relationship', description: 'Vehicle velocity dropped toward zero (0.08 m/s)', source: 'state_estimator', value: 0.08, baseline: 0.80, change_pct: -90.0, confidence: 0.90, supports: ['DRIVETRAIN_OBSTRUCTION'], contradicts: ['RPM_SENSOR_FAILURE'] },
      { id: 'E004', type: 'observed_behavior', description: 'Motor throttle command remained sustained high (PWM 200)', source: 'controller', value: 200.0, baseline: 200.0, change_pct: 0.0, confidence: 1.0, supports: ['DRIVETRAIN_OBSTRUCTION'], contradicts: [] },
      { id: 'E005', type: 'temporal_pattern', description: 'Abnormal condition persisted for > 3.0 seconds', source: 'temporal_window', value: 3.5, baseline: 0.0, change_pct: null, confidence: 0.95, supports: ['DRIVETRAIN_OBSTRUCTION'], contradicts: [] },
    ],
    reasoning: [
      { statement: 'The combination of elevated current and collapsed RPM under sustained throttle command is consistent with increased mechanical resistance.', evidence_ids: ['E001', 'E002', 'E004'] },
      { statement: 'Vehicle velocity also decreased toward zero, confirming physical drivetrain stall rather than an isolated sensor reporting error.', evidence_ids: ['E003'] },
    ],
    uncertainty: [
      'Telemetry cannot determine whether resistance is caused by a blocked wheel, axle binding, or internal gear mesh fault.',
      'Physical inspection is required to identify the specific mechanical component.',
    ],
    recommended_checks: [
      { step: 1, action: 'Inspect wheels for external obstruction or debris.', target_component: 'wheels_axle', safety_priority: 'high' },
      { step: 2, action: 'Check drivetrain and differential for mechanical binding.', target_component: 'drivetrain', safety_priority: 'high' },
      { step: 3, action: 'Inspect motor pinions and gearbox coupling.', target_component: 'gearbox', safety_priority: 'medium' },
      { step: 4, action: 'Perform a low-throttle (PWM 50) verification test.', target_component: 'system', safety_priority: 'low' },
    ],
    recommended_action: ['Cut high throttle command and inspect wheels and drivetrain for mechanical binding.'],
  };

  // 1. Healthy rendering test
  it('1. Renders healthy machine status correctly without false warnings', () => {
    render(
      <MachineStatusBanner
        healthStatus="HEALTHY"
        latestTelemetry={mockHealthyTelemetry}
        latestDiagnosis={null}
        activeAnomalyCount={0}
        machineId="car-01"
      />
    );
    expect(screen.getByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByText('Machine Operating Normally')).toBeInTheDocument();
  });

  // 2. Investigating rendering test
  it('2. Renders investigating state when anomalies occur before diagnosis is finalized', () => {
    render(
      <MachineStatusBanner
        healthStatus="INVESTIGATING"
        latestTelemetry={{ ...mockHealthyTelemetry, is_anomaly: 1 }}
        latestDiagnosis={null}
        activeAnomalyCount={2}
        machineId="car-01"
      />
    );
    expect(screen.getByText('INVESTIGATING')).toBeInTheDocument();
    expect(screen.getByText(/Abnormal Sensor Relationship/i)).toBeInTheDocument();
  });

  // 3. Fault diagnosis rendering test
  it('3. Renders full fault diagnosis card with score, severity, and hypothesis label', () => {
    render(
      <DiagnosticPanel
        diagnosis={mockJamDiagnosis}
        healthStatus="FAULT DETECTED"
        latestTelemetry={mockHealthyTelemetry}
      />
    );
    expect(screen.getByText('PRIMARY HYPOTHESIS')).toBeInTheDocument();
    expect(screen.getAllByText('Possible drivetrain obstruction').length).toBeGreaterThan(0);
    expect(screen.getByText(/Diagnostic Score:/i)).toBeInTheDocument();
    expect(screen.getAllByText(/0.92/i).length).toBeGreaterThan(0);
  });

  // 4. Alternative hypotheses rendering test
  it('4. Renders alternative hypotheses and expands to show why considered vs contradicted', () => {
    render(
      <AlternativeHypothesesSection
        alternatives={mockJamDiagnosis.alternative_hypotheses}
      />
    );
    expect(screen.getByText(/ALTERNATIVE HYPOTHESES CONSIDERED/i)).toBeInTheDocument();
    expect(screen.getByText('Motor Thermal Overload')).toBeInTheDocument();
    expect(screen.getByText('Wheel Speed / RPM Sensor Failure')).toBeInTheDocument();

    // Click to expand RPM Sensor Failure
    const button = screen.getByRole('button', { name: /Wheel Speed \/ RPM Sensor Failure/i });
    fireEvent.click(button);

    // Verify "Why Considered" and "Why Less Supported" are shown
    expect(screen.getByText(/Why Considered/i)).toBeInTheDocument();
    expect(screen.getByText(/Why Less Supported/i)).toBeInTheDocument();
  });

  // 5. Evidence rendering test
  it('5. Renders structured observations with evidence IDs and checkmarks', () => {
    render(<WhySection diagnosis={mockJamDiagnosis} />);
    expect(screen.getByText(/WHY DOES MACHSIGHT THINK THIS\?/i)).toBeInTheDocument();
    expect(screen.getByText(/1. OBSERVED \(DATA\)/i)).toBeInTheDocument();
    expect(screen.getByText(/2. INFERRED \(PHYSICS\)/i)).toBeInTheDocument();
    expect(screen.getByText(/3. HYPOTHESIS/i)).toBeInTheDocument();
    expect(screen.getByText(/4. ACTION/i)).toBeInTheDocument();
    expect(screen.getByText(/\[E001\]/i)).toBeInTheDocument();
    expect(screen.getByText(/\[E002\]/i)).toBeInTheDocument();
  });

  // 6. Uncertainty rendering test
  it('6. Renders explicit diagnostic limitations and physical inspection requirements', () => {
    render(<UncertaintySection uncertainty={mockJamDiagnosis.uncertainty} />);
    expect(screen.getByText(/WHAT MACHSIGHT CANNOT DETERMINE/i)).toBeInTheDocument();
    expect(screen.getByText(/Physical inspection is required/i)).toBeInTheDocument();
  });

  // 7. Recommendations rendering test
  it('7. Renders ordered technician steps and high severity safety advisory', () => {
    render(
      <RecommendedActionsSection
        checks={mockJamDiagnosis.recommended_checks}
        action={mockJamDiagnosis.recommended_action}
        severity="critical"
      />
    );
    expect(screen.getByText(/RECOMMENDED TECHNICIAN NEXT STEPS/i)).toBeInTheDocument();
    expect(screen.getByText(/SAFETY ADVISORY/i)).toBeInTheDocument();
    expect(screen.getByText(/Inspect wheels for external obstruction/i)).toBeInTheDocument();
    expect(screen.getByText(/Check drivetrain and differential/i)).toBeInTheDocument();
  });

  // 8. Recovery rendering test
  it('8. Renders recovery card displaying signal normalization after fault clearance', () => {
    render(
      <RecoveryCard
        diagnosis={{ ...mockJamDiagnosis, is_recovery: true }}
        latestTelemetry={mockHealthyTelemetry}
      />
    );
    expect(screen.getByText(/RECOVERY CONFIRMED/i)).toBeInTheDocument();
    expect(screen.getByText(/SYSTEM HEALTHY/i)).toBeInTheDocument();
    expect(screen.getByText(/Returned to nominal baseline/i)).toBeInTheDocument();
  });

  // 9. Disconnected rendering test
  it('9. Renders offline indicator when disconnected without fabricating live faults', () => {
    render(
      <MachineStatusBanner
        healthStatus="OFFLINE"
        latestTelemetry={null}
        latestDiagnosis={null}
        activeAnomalyCount={0}
        machineId="car-01"
      />
    );
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Telemetry Connection')).toBeInTheDocument();
  });

  // 10. Reasoning unavailable / fallback rendering test
  it('10. Transparently displays fallback badge when language model reasoning service is unavailable', () => {
    const fallbackDiagnosis: ParsedDiagnosis = {
      ...mockJamDiagnosis,
      fallback_active: true,
      fallback_reason: 'Ollama unreachable',
    };
    render(<WhySection diagnosis={fallbackDiagnosis} />);
    expect(screen.getByText(/Deterministic Rules \(Fallback\)/i)).toBeInTheDocument();
  });
});
