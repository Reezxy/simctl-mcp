import type { AppInfo, McpToolDef, Simulator } from "../types.js";
export declare function listSimulators(): Promise<Simulator[]>;
export declare function getBootedSimulator(): Promise<Simulator | null>;
export declare function installApp(appPath: string): Promise<void>;
export declare function launchApp(bundleId: string, resetState?: boolean): Promise<string>;
export declare function terminateApp(bundleId: string): Promise<void>;
export declare function getAppInfo(bundleId: string): Promise<AppInfo>;
export declare const simulatorTools: McpToolDef[];
//# sourceMappingURL=simulator.d.ts.map