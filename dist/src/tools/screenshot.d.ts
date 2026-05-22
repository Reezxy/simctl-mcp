import type { McpToolDef, McpToolResult } from "../types.js";
export declare function captureRawPng(screenName?: string): Promise<string>;
export declare function takeScreenshot(screenName?: string): Promise<McpToolResult>;
export declare function compareScreenshot(baselinePath: string, thresholdPercent?: number): Promise<McpToolResult>;
export declare const screenshotTools: McpToolDef[];
//# sourceMappingURL=screenshot.d.ts.map