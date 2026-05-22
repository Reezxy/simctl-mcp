import type { McpToolDef, ScreenDescription, UIElement } from "../types.js";
export declare function getAccessibilityTree(): Promise<{
    elements: UIElement[];
    truncated: boolean;
    totalCount: number;
}>;
export declare function describeCurrentScreen(): Promise<ScreenDescription>;
export declare const accessibilityTools: McpToolDef[];
//# sourceMappingURL=accessibility.d.ts.map