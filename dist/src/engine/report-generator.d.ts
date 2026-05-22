import { getStats } from "./screen-graph.js";
import type { Bug, ScreenNode } from "../types.js";
export type ReportFormat = "markdown" | "json";
export declare function buildSummaryTable(stats: ReturnType<typeof getStats>): string;
export declare function buildBugSection(bugs: Bug[]): string;
export declare function buildCoverageTable(nodes: ScreenNode[]): string;
export declare function buildRecommendations(stats: ReturnType<typeof getStats>, bugs: Bug[]): string;
export declare function buildMarkdownReport(appName?: string, appVersion?: string): string;
export declare function buildJsonReport(appName?: string, appVersion?: string): object;
export declare function generateReport(format: ReportFormat, appName?: string, appVersion?: string): Promise<string>;
//# sourceMappingURL=report-generator.d.ts.map