import type { Bug, ScreenEdge, ScreenNode, TestResult } from "../types.js";
/**
 * Registers a screen or increments its visit count if already known.
 * Returns the (possibly updated) node.
 */
export declare function registerScreen(name: string, description?: string): ScreenNode;
/**
 * Records the test outcome for a screen.
 */
export declare function markScreenTested(name: string, result: TestResult, notes?: string): ScreenNode;
/**
 * Returns true when a screen has been visited `maxVisits` or more times,
 * indicating the loop-prevention limit has been reached.
 */
export declare function hasVisitedTooManyTimes(name: string, maxVisits?: number): boolean;
/**
 * Records a navigation transition in the graph.
 * Skips duplicate edges (same from → to via same action).
 */
export declare function addEdge(from: string, to: string, action: string): void;
/**
 * Adds a bug to the report.  Returns the created Bug with a unique ID.
 */
export declare function addBug(severity: Bug["severity"], title: string, description: string, screen: string, screenshotPath?: string, logExcerpt?: string): Bug;
export interface ScreenGraph {
    nodes: ScreenNode[];
    edges: ScreenEdge[];
}
export declare function getGraph(): ScreenGraph;
export declare function getBugs(): Bug[];
export interface SessionStats {
    sessionStartMs: number;
    durationMs: number;
    screensDiscovered: number;
    screensTested: number;
    screensBlocked: number;
    screensPassed: number;
    screensFailed: number;
    screensSkipped: number;
    coveragePercent: number;
    bugsByCritical: number;
    bugsByHigh: number;
    bugsByMedium: number;
    bugsByLow: number;
    totalBugs: number;
    crashes: number;
}
export declare function getStats(): SessionStats;
/**
 * Resets all state — used for tests and new test sessions.
 */
export declare function resetGraph(): void;
//# sourceMappingURL=screen-graph.d.ts.map