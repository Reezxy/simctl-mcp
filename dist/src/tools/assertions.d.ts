import type { AssertionResult, McpToolDef } from "../types.js";
export interface CrashResult {
    crashed: boolean;
    crash_summary?: string;
}
export interface LogCheckResult {
    passed: boolean;
    matched_lines: string[];
    message: string;
}
export declare function assertElementExists(label: string, shouldExist?: boolean): Promise<AssertionResult>;
export declare function assertTextEquals(label: string, expectedText: string): Promise<AssertionResult>;
export declare function assertElementEnabled(label: string, shouldBeEnabled?: boolean): Promise<AssertionResult>;
export declare function assertNoCrash(): Promise<CrashResult>;
export declare function assertNoErrorInLogs(patterns?: string[]): Promise<LogCheckResult>;
/** Resets the crash-check baseline to now (useful for tests). */
export declare function resetCrashBaseline(): void;
export declare const assertionTools: McpToolDef[];
//# sourceMappingURL=assertions.d.ts.map