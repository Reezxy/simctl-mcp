import type { McpToolDef, McpToolResult } from "../types.js";
export declare function tapByLabel(label: string, fallbackScreenshot?: boolean): Promise<McpToolResult>;
export declare function tapAt(x: number, y: number): Promise<void>;
export declare function inputText(text: string, clearFirst?: boolean): Promise<void>;
export type SwipeDirection = "up" | "down" | "left" | "right";
export declare function swipe(direction: SwipeDirection, distancePercent?: number, screenWidth?: number, screenHeight?: number): Promise<void>;
export declare function scrollToElement(label: string, maxScrolls?: number): Promise<{
    found: boolean;
    scrollsPerformed: number;
}>;
export type HardwareButton = "home" | "lock" | "rotate_left" | "rotate_right";
export declare function pressHardwareButton(button: HardwareButton): Promise<void>;
export declare function longPress(label: string, durationMs?: number): Promise<void>;
export declare function drag(fromLabel: string, toLabel: string): Promise<void>;
export declare const interactionTools: McpToolDef[];
//# sourceMappingURL=interaction.d.ts.map