// MachSight Operator Dashboard Domain Types
// Strictly mirrors backend WebSocket and REST contracts (Phase 5.5 / Phase 6 / Priority 2 & 3)

export type ConnectionState = 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED';

// Machine status aligned with Priority 3 specification
export type MachineHealthStatus =
  | 'HEALTHY'
  | 'INVESTIGATING'
  | 'FAULT DETECTED'
  | 'RECOVERING'
  | 'RECOVERED'
  | 'OFFLINE'
  // Legacy aliases
  | 'ATTENTION'
  | 'ANOMALY'
  | 'SENSOR_ISSUE'
  | 'UNKNOWN';

export type DashboardTab = 'DASHBOARD' | 'OVERVIEW' | 'DIAGNOSTICS' | 'LOGS' | 'SIMULATOR';

export interface TelemetryPoint {
  readonly time: string;
  readonly timestamp: number;
  readonly distance_cm: number | null;
  readonly current_a: number | null;
  readonly rpm: number | null;
  readonly velocity_mps?: number | null;
  readonly mode: string;
  readonly pwm_command: number;
  readonly is_anomaly: number; // 0 | 1
  readonly mahalanobis_distance: number;
  readonly current_zscore: number;
  readonly rpm_zscore: number;
  readonly distance_plausible: number; // 0 | 1
  readonly bucket_used: string;
  readonly raw_id: number;
  readonly machine_id: string;
}

export interface HypothesisCandidate {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly diagnostic_score: number;
  readonly affected_subsystem: string;
  readonly supporting_evidence_ids?: readonly string[];
  readonly contradicting_evidence_ids?: readonly string[];
  readonly matched_supporting_patterns?: readonly string[];
  readonly matched_contradicting_patterns?: readonly string[];
}

export interface StructuredEvidenceItem {
  readonly id: string;
  readonly type: 'observed_behavior' | 'derived_relationship' | 'temporal_pattern' | string;
  readonly description: string;
  readonly source: string;
  readonly value: number | null;
  readonly baseline: number | null;
  readonly change_pct: number | null;
  readonly confidence: number;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
}

export interface StructuredReasoningStatement {
  readonly statement: string;
  readonly evidence_ids: readonly string[];
}

export interface RecommendedCheckStep {
  readonly step: number;
  readonly action: string;
  readonly target_component: string;
  readonly safety_priority?: string;
}

export interface WhatChangedItem {
  readonly metric: string;
  readonly baseline: string;
  readonly current: string;
  readonly change: string;
  readonly status: 'nominal' | 'elevated' | 'collapsed' | 'stalled' | 'concerning' | string;
}

export interface ParsedDiagnosis {
  readonly action?: 'diagnose' | 'request_more_data';
  readonly reasoning?: string | readonly StructuredReasoningStatement[];
  readonly diagnosis: string | null;
  readonly confidence: number | null;
  readonly evidence_used?: readonly string[];
  readonly recommended_action?: string | readonly string[] | null;
  readonly more_data?: {
    readonly seconds: number;
    readonly focus: string;
  } | null;
  readonly severity: 'warning' | 'critical' | 'info';
  readonly ui_hints?: {
    readonly highlight_metrics: readonly string[];
    readonly suggested_charts: readonly string[];
  };
  readonly stage?: 'preliminary' | 'final';
  readonly suspected_component?: string | { component_id?: string; display_name?: string } | null;
  readonly trace_id?: string;
  readonly timestamp?: number;

  // Phase 2 & Priority 3 Extensions
  readonly machine_id?: string;
  readonly machine_state?: string;
  readonly operating_state?: string;
  readonly is_recovery?: boolean;
  readonly fallback_active?: boolean;
  readonly fallback_reason?: string | null;
  readonly primary_hypothesis?: HypothesisCandidate | null;
  readonly alternative_hypotheses?: readonly HypothesisCandidate[];
  readonly evidence?: readonly StructuredEvidenceItem[];
  readonly uncertainty?: readonly string[];
  readonly recommended_checks?: readonly RecommendedCheckStep[];
  readonly what_changed?: readonly WhatChangedItem[];
  readonly signals_summary?: Record<string, unknown>;
}

export interface TimelineEvent {
  readonly id: string;
  readonly timestamp: number; // epoch ms or s
  readonly timeFormatted: string;
  readonly type: 'connection' | 'anomaly' | 'diagnosis' | 'recovery' | 'sensor_issue' | 'simulator' | 'lifecycle';
  readonly title: string;
  readonly description: string;
  readonly severity: 'nominal' | 'info' | 'warning' | 'critical';
  readonly metadata?: Record<string, unknown>;
}

export interface QualityMetrics {
  readonly packetFreshnessMs: number | null;
  readonly lastTimestamp: number | null;
  readonly distancePlausible: boolean;
  readonly mahalanobisDistance: number;
  readonly currentZScore: number;
  readonly rpmZScore: number;
  readonly bucketUsed: string;
  readonly totalPackets: number;
  readonly totalAnomalies: number;
}

export interface BackendStatus {
  readonly status: string;
  readonly llm_reachable: boolean;
  readonly active_model: string;
  readonly fallback_active: boolean;
  readonly db_row_counts?: Record<string, number>;
  readonly machines?: Record<string, unknown>;
}

export interface SimulatorStatus {
  readonly running: boolean;
  readonly paused?: boolean;
  readonly scenario?: string | null;
  readonly simulation_time_s?: number;
  readonly machine_id?: string;
  readonly mode?: string;
  readonly pwm_command?: number;
  readonly velocity_mps?: number;
  readonly wheel_rpm?: number;
  readonly motor_current?: number;
  readonly battery_state_pct?: number;
  readonly active_faults?: readonly string[];
}
