import React from 'react';
import type { QualityMetrics, ConnectionState, BackendStatus } from '../types/domain';
interface Props {
    readonly connectionState: ConnectionState;
    readonly quality: QualityMetrics;
    readonly backendStatus: BackendStatus | null;
}
export declare const DataQualityPanel: React.FC<Props>;
export {};
//# sourceMappingURL=DataQualityPanel.d.ts.map