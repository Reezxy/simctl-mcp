import type { McpToolDef } from "../types.js";
import { mockServerState } from "../../mock-server/state.js";
interface CrashSummary {
    file: string;
    timestamp: number;
    exceptionType: string;
    exceptionSubtype: string;
    processName: string;
    topFrames: string[];
}
export declare function getConsoleLogs(lines?: number, filter?: string): Promise<string[]>;
export declare function getCrashLogs(bundleId?: string): Promise<CrashSummary[]>;
export declare function getNetworkCalls(sinceMs?: number): Promise<{
    calls: typeof mockServerState.requests;
    serverRunning: boolean;
}>;
export declare function startMockServer(port?: number, routesConfig?: Record<string, unknown>): Promise<{
    port: number;
    message: string;
}>;
export declare function stopMockServer(): Promise<{
    totalCalls: number;
    calls: typeof mockServerState.requests;
}>;
export declare const diagnosticTools: McpToolDef[];
export {};
//# sourceMappingURL=diagnostics.d.ts.map