import React from 'react';
import type { MachineHealthStatus, TelemetryPoint, ParsedDiagnosis } from '../types/domain';
interface Props {
    readonly healthStatus: MachineHealthStatus;
    readonly latestTelemetry: TelemetryPoint | null;
    readonly latestDiagnosis: ParsedDiagnosis | null;
    readonly activeAnomalyCount: number;
    readonly machineId: string;
}
export declare const MachineStatusBanner: React.FC<Props>;
export {};
//# sourceMappingURL=MachineStatusBanner.d.ts.map