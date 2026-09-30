import { type ReactElement } from 'react';
export type OperationalStatus = 'NOMINAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
export type DiagnosticSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type DiagnosticStatus = 'PENDING_ACK' | 'TRIAGED' | 'DISPATCHED' | 'RESOLVED';
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'CRIT';
export type SubsystemType = 'DRIVETRAIN' | 'MOTOR_ASSEMBLY' | 'ULTRASONIC_ARRAY' | 'POWER_TRAIN' | 'THERMAL_LOOP' | 'VISION_INSPECT';
export type DashboardTab = 'LANDING' | 'OVERVIEW' | 'DIAGNOSTICS' | 'LOGS' | 'SIMULATOR';
export type LogFilterSeverity = 'ALL' | 'CRIT' | 'WARN';
export interface TelemetryPoint {
    readonly time: string;
    readonly distance_cm: number;
    readonly current_a: number;
    readonly rpm: number;
    readonly mode: string;
    readonly pwm_command: number;
}
export interface WebSocketProcessedEvent {
    readonly type: 'processed';
    readonly event: 'processed';
    readonly data: {
        readonly raw_id: number;
        readonly timestamp: number;
        readonly current_rpm_ratio: number;
        readonly current_zscore: number;
        readonly rpm_zscore: number;
        readonly mahalanobis_distance: number;
        readonly distance_plausible: number;
        readonly bucket_used: string;
        readonly is_anomaly: number;
        readonly id: number;
        readonly machine_id?: string;
        readonly distance_cm?: number | null;
        readonly current_a?: number | null;
        readonly rpm?: number | null;
        readonly mode?: string;
        readonly pwm_command?: number;
    };
}
export interface WebSocketInvestigationStepEvent {
    readonly type: 'investigation_step';
    readonly event: 'investigation_step';
    readonly data: {
        readonly trace_id: string;
        readonly timestamp: number;
        readonly step_type: 'reasoning';
        readonly payload: string;
    };
}
export interface WebSocketDiagnosisEvent {
    readonly type: 'diagnosis';
    readonly event: 'diagnosis';
    readonly data: {
        readonly trace_id: string;
        readonly timestamp: number;
        readonly step_type: 'diagnosis';
        readonly payload: string;
    };
}
export type WebSocketEvent = WebSocketProcessedEvent | WebSocketInvestigationStepEvent | WebSocketDiagnosisEvent;
export interface ParsedPayload {
    readonly action: string;
    readonly reasoning: string;
    readonly diagnosis: string | null;
    readonly confidence: number | null;
    readonly evidence_used: readonly string[];
    readonly recommended_action: string | null;
    readonly more_data: {
        readonly seconds: number;
        readonly focus: string;
    } | null;
    readonly severity: 'warning' | 'critical' | 'info';
    readonly ui_hints: {
        readonly highlight_metrics: readonly string[];
        readonly suggested_charts: readonly string[];
    };
    readonly stage?: 'preliminary' | 'final';
}
export interface MachineUnit {
    readonly id: string;
    readonly tag: string;
    readonly name: string;
    readonly area: string;
    readonly status: OperationalStatus;
    readonly runtimeHours: number;
    readonly healthIndex: number;
    readonly lastAnomaly: string;
    readonly telemetry: readonly TelemetryPoint[];
    readonly activeAlertCount: number;
    readonly connected: boolean;
}
export interface LogEntry {
    readonly id: string;
    readonly timestamp: string;
    readonly machineId: string;
    readonly level: LogSeverity;
    readonly subsystem: SubsystemType;
    readonly message: string;
    readonly metricTrigger?: string;
}
export interface DiagnosticFinding {
    readonly id: string;
    readonly timestamp: string;
    readonly machineId: string;
    readonly severity: DiagnosticSeverity;
    readonly confidence: number;
    readonly title: string;
    readonly rootCauseHypothesis: string;
    readonly evidencePoints: readonly string[];
    readonly recommendedAction: string;
    readonly status: DiagnosticStatus;
    readonly stage?: 'preliminary' | 'final';
    readonly traceId?: string;
}
export interface SvgSparklineProps {
    readonly data: readonly number[];
    readonly color?: string;
    readonly height?: number;
    readonly width?: number;
    readonly minVal?: number;
    readonly maxVal?: number;
    readonly fill?: boolean;
    readonly showMinMax?: boolean;
    readonly unit?: string;
}
export interface StatusBadgeProps {
    readonly status: OperationalStatus;
}
export interface LogLevelBadgeProps {
    readonly level: LogSeverity;
}
export interface HeaderProps {
    readonly activeTab: DashboardTab;
    readonly setActiveTab: (tab: DashboardTab) => void;
    readonly darkMode: boolean;
    readonly setDarkMode: (dark: boolean) => void;
    readonly streamActive: boolean;
    readonly setStreamActive: (active: boolean) => void;
    readonly packetCount: number;
    readonly activeAlertCount: number;
    readonly aiAnalysisRunning: boolean;
    readonly triggerManualDiagnostics: () => void;
    readonly onOpenIoConfig: () => void;
    readonly isConnected: boolean;
    readonly deviceConnected: boolean;
    readonly onOpenDeviceDialog: () => void;
}
export interface IoConfigModalProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly wsEndpoint: string;
    readonly setWsEndpoint: (endpoint: string) => void;
    readonly streamActive: boolean;
    readonly isConnected: boolean;
}
export interface DeviceConnectionDialogProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onConnect: (deviceId: string) => void;
    readonly deviceConnected: boolean;
}
export declare function StatusBadge({ status }: StatusBadgeProps): ReactElement;
export declare function LogLevelBadge({ level }: LogLevelBadgeProps): ReactElement;
export declare function SvgSparkline({ data, color, height, width, minVal, maxVal, fill, showMinMax, unit, }: SvgSparklineProps): ReactElement;
export declare function DashboardHeader({ activeTab, setActiveTab, darkMode, setDarkMode, streamActive, setStreamActive, packetCount, activeAlertCount, aiAnalysisRunning, triggerManualDiagnostics, onOpenIoConfig, isConnected, deviceConnected, onOpenDeviceDialog, }: HeaderProps): ReactElement;
export declare function IoConfigModal({ isOpen, onClose, wsEndpoint, setWsEndpoint, streamActive, isConnected, }: IoConfigModalProps): ReactElement | null;
export declare function DeviceConnectionDialog({ isOpen, onClose, onConnect, deviceConnected, }: DeviceConnectionDialogProps): ReactElement | null;
export default function IndustrialDoctorApp(): ReactElement;
//# sourceMappingURL=IndustrialDoctor.d.ts.map