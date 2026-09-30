import type { ConnectionState, MachineHealthStatus, TelemetryPoint, ParsedDiagnosis, TimelineEvent, QualityMetrics, BackendStatus } from '../types/domain';
export interface UseMachSightReturn {
    readonly connectionState: ConnectionState;
    readonly healthStatus: MachineHealthStatus;
    readonly latestTelemetry: TelemetryPoint | null;
    readonly telemetryHistory: readonly TelemetryPoint[];
    readonly latestDiagnosis: ParsedDiagnosis | null;
    readonly diagnosisHistory: readonly ParsedDiagnosis[];
    readonly timelineEvents: readonly TimelineEvent[];
    readonly qualityMetrics: QualityMetrics;
    readonly backendStatus: BackendStatus | null;
    readonly packetCount: number;
    readonly machineId: string;
    readonly highlightMetrics: readonly string[];
    readonly activeAnomalyCount: number;
    readonly reconnect: () => void;
    readonly setCustomWsEndpoint: (url: string) => void;
    readonly wsEndpoint: string;
}
export declare function useMachSightWebSocket(defaultWsUrl?: string): UseMachSightReturn;
//# sourceMappingURL=useMachSightWebSocket.d.ts.map