export interface Simulator {
    udid: string;
    name: string;
    os: string;
    state: "Booted" | "Shutdown" | "Booting" | "ShuttingDown" | string;
    isAvailable: boolean;
}
export interface AppInfo {
    bundleId: string;
    displayName: string;
    version: string;
    buildNumber: string;
    minimumOS: string;
    entitlements: Record<string, unknown> | null;
}
export interface UIElement {
    label: string;
    type: string;
    value?: string;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    enabled: boolean;
    visible: boolean;
    depth: number;
    parent_label?: string;
    children_count: number;
}
export type ScreenType = "list" | "detail" | "form" | "modal" | "tab-bar" | "onboarding" | "auth" | "unknown";
export interface ScreenDescription {
    title: string | null;
    screenType: ScreenType;
    interactiveElements: UIElement[];
    visibleText: string[];
    suggestedActions: string[];
}
export interface AssertionResult {
    passed: boolean;
    message: string;
}
export interface WaitResult {
    found: boolean;
    elapsed_ms: number;
    timed_out?: boolean;
}
export interface StabilityResult {
    stable: boolean;
    elapsed_ms: number;
    final_diff_percent: number;
}
export type TestResult = "pass" | "fail" | "skip" | "blocked";
export interface ScreenNode {
    name: string;
    description?: string;
    result?: TestResult;
    notes?: string;
    visitCount: number;
    discoveredAt: number;
}
export interface ScreenEdge {
    from: string;
    to: string;
    action: string;
}
export interface Bug {
    id: string;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    description: string;
    screen: string;
    screenshotPath?: string;
    logExcerpt?: string;
    timestamp: number;
}
export type McpContent = {
    type: "text";
    text: string;
} | {
    type: "image";
    data: string;
    mimeType: string;
};
export interface McpToolResult {
    content: McpContent[];
    isError?: boolean;
}
export type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>;
export interface McpToolDef {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    handler: ToolHandler;
}
export declare function toolError(message: string): McpToolResult;
export declare function toolOk(data: unknown): McpToolResult;
//# sourceMappingURL=types.d.ts.map