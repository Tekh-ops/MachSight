import React from 'react';
import type { TelemetryPoint } from '../types/domain';
interface Props {
    readonly latestTelemetry: TelemetryPoint | null;
    readonly highlightMetrics: readonly string[];
    readonly isAnomaly: boolean;
}
export declare const TelemetryCards: React.FC<Props>;
export {};
//# sourceMappingURL=TelemetryCards.d.ts.map