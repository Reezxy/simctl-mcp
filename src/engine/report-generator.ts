import { getGraph, getBugs, getStats } from "./screen-graph.js";
import type { Bug, ScreenNode } from "../types.js";

export type ReportFormat = "markdown" | "json";

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function severityLabel(s: Bug["severity"]): string {
  return s.toUpperCase();
}

function resultLabel(result?: ScreenNode["result"]): string {
  if (!result) return "UNTESTED";
  return result.toUpperCase();
}

// ── Section builders (exported for tests) ─────────────────────────────────────

export function buildSummaryTable(stats: ReturnType<typeof getStats>): string {
  const rows: Array<[string, string | number]> = [
    ["Screens discovered", stats.screensDiscovered],
    ["Screens fully tested", stats.screensTested],
    ["Screens blocked", stats.screensBlocked],
    ["Screens passed", stats.screensPassed],
    ["Screens failed", stats.screensFailed],
    ["Coverage", `${stats.coveragePercent}%`],
    ["Bugs — Critical", stats.bugsByCritical],
    ["Bugs — High", stats.bugsByHigh],
    ["Bugs — Medium", stats.bugsByMedium],
    ["Bugs — Low", stats.bugsByLow],
    ["Total bugs", stats.totalBugs],
    ["Crashes", stats.crashes],
  ];

  const lines = [
    "| Metric | Value |",
    "|--------|-------|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ];
  return lines.join("\n");
}

export function buildBugSection(bugs: Bug[]): string {
  if (bugs.length === 0) {
    return "_No bugs recorded._";
  }

  const order: Bug["severity"][] = ["critical", "high", "medium", "low"];
  const sections: string[] = [];

  for (const sev of order) {
    const group = bugs.filter((b) => b.severity === sev);
    if (group.length === 0) continue;

    for (const bug of group) {
      const parts = [
        `### [${severityLabel(bug.severity)}] ${bug.title}`,
        "",
        `**ID**: ${bug.id}  `,
        `**Screen**: ${bug.screen}  `,
        `**Reported**: ${formatTimestamp(bug.timestamp)}`,
        "",
        bug.description,
      ];

      if (bug.logExcerpt) {
        parts.push("", "**Log excerpt**:", "```", bug.logExcerpt, "```");
      }

      if (bug.screenshotPath) {
        parts.push("", `**Screenshot**: ![${bug.id}](${bug.screenshotPath})`);
      }

      sections.push(parts.join("\n"));
    }
  }

  return sections.join("\n\n---\n\n");
}

export function buildCoverageTable(nodes: ScreenNode[]): string {
  if (nodes.length === 0) {
    return "_No screens registered._";
  }

  // Sort: untested first, then alphabetical
  const sorted = [...nodes].sort((a, b) => {
    if (!a.result && b.result) return -1;
    if (a.result && !b.result) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines = [
    "| Screen | Status | Visits | Notes |",
    "|--------|--------|--------|-------|",
    ...sorted.map(
      (n) =>
        `| ${n.name} | ${resultLabel(n.result)} | ${n.visitCount} | ${n.notes ?? ""} |`
    ),
  ];
  return lines.join("\n");
}

export function buildRecommendations(
  stats: ReturnType<typeof getStats>,
  bugs: Bug[]
): string {
  const items: string[] = [];

  // Crashes first
  if (stats.crashes > 0) {
    const crashBugs = bugs.filter((b) =>
      b.title.toLowerCase().includes("crash")
    );
    for (const b of crashBugs) {
      items.push(
        `**[Must fix before release]** Crash on "${b.screen}": ${b.title}`
      );
    }
  }

  // Critical bugs
  const criticals = bugs.filter((b) => b.severity === "critical");
  for (const b of criticals) {
    if (!b.title.toLowerCase().includes("crash")) {
      items.push(`**[Critical]** Fix "${b.title}" on ${b.screen}`);
    }
  }

  // High severity
  const highs = bugs.filter((b) => b.severity === "high");
  if (highs.length > 0) {
    items.push(
      `**[High priority]** Address ${highs.length} high-severity bug(s): ` +
        highs.map((b) => b.title).join("; ")
    );
  }

  // Blocked screens
  if (stats.screensBlocked > 0) {
    items.push(
      `**[Investigate]** ${stats.screensBlocked} screen(s) were blocked — ` +
        "check accessibility labels and navigation paths"
    );
  }

  // Coverage
  if (stats.coveragePercent < 80 && stats.screensDiscovered > 0) {
    items.push(
      `**[Coverage]** Only ${stats.coveragePercent}% of screens were tested — ` +
        "consider adding predefined test flows for hard-to-reach screens"
    );
  }

  if (items.length === 0) {
    items.push("No critical issues found. Consider expanding test coverage with edge cases.");
  }

  return items.map((i) => `- ${i}`).join("\n");
}

// ── Top-level report builders ─────────────────────────────────────────────────

export function buildMarkdownReport(
  appName = "Unknown App",
  appVersion = ""
): string {
  const stats = getStats();
  const { nodes, edges } = getGraph();
  const bugs = getBugs();

  const appLabel = appVersion ? `${appName} ${appVersion}` : appName;
  const generated = formatTimestamp(Date.now());
  const duration = formatDuration(stats.durationMs);

  const header = [
    `# iOS Test Report — ${appLabel}`,
    "",
    `**Generated:** ${generated} | **Duration:** ${duration} | **Screens:** ${stats.screensDiscovered} | **Bugs:** ${stats.totalBugs}`,
  ].join("\n");

  const summary = ["## Summary", "", buildSummaryTable(stats)].join("\n");

  const bugsSection = [
    "## Bugs Found",
    "",
    buildBugSection(bugs),
  ].join("\n");

  const coverage = [
    "## Screen Coverage",
    "",
    buildCoverageTable(nodes),
    "",
    `_Navigation edges recorded: ${edges.length}_`,
  ].join("\n");

  const recommendations = [
    "## Recommendations",
    "",
    buildRecommendations(stats, bugs),
  ].join("\n");

  return [header, summary, bugsSection, coverage, recommendations].join(
    "\n\n"
  );
}

export function buildJsonReport(
  appName = "Unknown App",
  appVersion = ""
): object {
  const stats = getStats();
  const { nodes, edges } = getGraph();
  const bugs = getBugs();

  return {
    meta: {
      appName,
      appVersion,
      generatedAt: new Date().toISOString(),
      durationMs: stats.durationMs,
      durationFormatted: formatDuration(stats.durationMs),
    },
    stats,
    bugs: bugs.map((b) => ({
      ...b,
      timestampFormatted: formatTimestamp(b.timestamp),
    })),
    screens: nodes.map((n) => ({
      ...n,
      discoveredAtFormatted: formatTimestamp(n.discoveredAt),
      status: resultLabel(n.result),
    })),
    graph: { nodes, edges },
    recommendations: buildRecommendations(stats, bugs)
      .split("\n")
      .map((l) => l.replace(/^- /, "").trim())
      .filter(Boolean),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateReport(
  format: ReportFormat,
  appName?: string,
  appVersion?: string
): Promise<string> {
  if (format === "json") {
    return JSON.stringify(buildJsonReport(appName, appVersion), null, 2);
  }
  return buildMarkdownReport(appName, appVersion);
}
