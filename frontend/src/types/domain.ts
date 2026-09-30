// MachSight Operator Dashboard Domain Types
// Strictly mirrors backend WebSocket and REST contracts (Phase 5.5 / Phase 6)

export type ConnectionState = 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED';

export type MachineHealthStatus = 'HEALTHY' | 'ATTENTION' | 'ANOMALY' | 'SENSOR_ISSUE' | 'UNKNOWN';

export type DashboardTab = 'DASHBOARD' | 'OVERVIEW' | 'DIAGNOSTICS' | 'LOGS' | 'SIMULATOR';

export interface TelemetryPoint {
  readonly time: string;
  readonly timestamp: number;
  readonly distance_cm: number | null;
  readonly current_a: number | null;
  readonly rpm: number | null;
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

export interface ParsedDiagnosis {
  readonly action: 'diagnose' | 'request_more_data';
  readonly reasoning: string;
  readonly diagnosis: string | null;
  readonly confidence: number | null;
  readonly evidence_used: readonly string[];
  readonly recommended_action: string | null;
  readonly more_data?: {
    readonly seconds: number;
    readonly focus: string;
  } | null;
  readonly severity: 'warning' | 'critical' | 'info';
  readonly ui_hints: {
    readonly highlight_metrics: readonly string[];
    readonly suggested_charts: readonly string[];
  };
  readonly stage?: 'preliminary' | 'final';
  readonly suspected_component?: string | { component_id?: string; display_name?: string } | null;
  readonly trace_id?: string;
  readonly timestamp?: number;
}

export interface TimelineEvent {
  readonly id: string;
  readonly timestamp: number; // epoch ms or s
  readonly timeFormatted: string;
  readonly type: 'connection' | 'anomaly' | 'diagnosis' | 'recovery' | 'sensor_issue' | 'simulator';
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
