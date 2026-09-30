import React from 'react';
import type { TelemetryPoint, ParsedDiagnosis, BackendStatus } from '../types/domain';
interface Props {
    readonly latestTelemetry: TelemetryPoint | null;
    readonly latestDiagnosis: ParsedDiagnosis | null;
    readonly backendStatus: BackendStatus | null;
    readonly wsEndpoint: string;
}
export declare const TechnicalDetails: React.FC<Props>;
export {};
//# sourceMappingURL=TechnicalDetails.d.ts.map