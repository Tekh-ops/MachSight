import React from 'react';
import type { ConnectionState, DashboardTab } from '../types/domain';
interface Props {
    readonly activeTab: DashboardTab;
    readonly setActiveTab: (tab: DashboardTab) => void;
    readonly connectionState: ConnectionState;
    readonly machineId: string;
    readonly lastUpdateTimestamp: number | null;
    readonly packetCount: number;
    readonly darkMode: boolean;
    readonly setDarkMode: (dark: boolean) => void;
    readonly onOpenConfig: () => void;
    readonly onReconnect: () => void;
}
export declare const Header: React.FC<Props>;
export {};
//# sourceMappingURL=Header.d.ts.map