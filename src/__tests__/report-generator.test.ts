import {
  buildSummaryTable,
  buildBugSection,
  buildCoverageTable,
  buildRecommendations,
  buildMarkdownReport,
  buildJsonReport,
  generateReport,
} from "../engine/report-generator.js";
import {
  resetGraph,
  registerScreen,
  markScreenTested,
  addBug,
  addEdge,
  getGraph,
  getStats,
} from "../engine/screen-graph.js";

beforeEach(() => {
  resetGraph();
});

// ── buildSummaryTable ──────────────────────────────────────────────────────────

describe("buildSummaryTable", () => {
  it("renders a markdown table with all metrics", () => {
    registerScreen("A");
    registerScreen("B");
    markScreenTested("A", "pass");
    markScreenTested("B", "fail");
    addBug("critical", "Crash", "desc", "B");
    addBug("high", "Bug", "desc", "A");

    const table = buildSummaryTable(getStats());

    expect(table).toContain("| Screens discovered | 2 |");
    expect(table).toContain("| Screens passed | 1 |");
    expect(table).toContain("| Bugs — Critical | 1 |");
    expect(table).toContain("| Bugs — High | 1 |");
    expect(table).toContain("| Coverage | 100% |");
  });

  it("shows 0% coverage for empty session", () => {
    const table = buildSummaryTable(getStats());
    expect(table).toContain("| Coverage | 0% |");
  });
});

// ── buildBugSection ────────────────────────────────────────────────────────────

describe("buildBugSection", () => {
  it("returns placeholder text when no bugs", () => {
    expect(buildBugSection([])).toContain("No bugs recorded");
  });

  it("orders bugs critical → high → medium → low", () => {
    const bugs = [
      { id: "bug_001", severity: "low" as const, title: "Low bug", description: "", screen: "S", timestamp: 1 },
      { id: "bug_002", severity: "critical" as const, title: "Critical bug", description: "", screen: "S", timestamp: 2 },
      { id: "bug_003", severity: "high" as const, title: "High bug", description: "", screen: "S", timestamp: 3 },
    ];

    const section = buildBugSection(bugs);
    const critPos = section.indexOf("[CRITICAL]");
    const highPos = section.indexOf("[HIGH]");
    const lowPos = section.indexOf("[LOW]");

    expect(critPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(lowPos);
  });

  it("includes bug ID, screen, and description", () => {
    const bugs = [{
      id: "bug_001",
      severity: "high" as const,
      title: "Button unresponsive",
      description: "Tap Submit → nothing happens",
      screen: "CheckoutScreen",
      timestamp: Date.now(),
    }];

    const section = buildBugSection(bugs);
    expect(section).toContain("bug_001");
    expect(section).toContain("CheckoutScreen");
    expect(section).toContain("Tap Submit → nothing happens");
    expect(section).toContain("[HIGH]");
  });

  it("includes log excerpt in code block when present", () => {
    const bugs = [{
      id: "bug_001",
      severity: "critical" as const,
      title: "Crash",
      description: "App crashes",
      screen: "Home",
      logExcerpt: "Fatal error: nil unwrapped",
      timestamp: Date.now(),
    }];

    const section = buildBugSection(bugs);
    expect(section).toContain("```");
    expect(section).toContain("Fatal error: nil unwrapped");
  });

  it("includes screenshot markdown when path provided", () => {
    const bugs = [{
      id: "bug_001",
      severity: "medium" as const,
      title: "Layout broken",
      description: "Overlap",
      screen: "Home",
      screenshotPath: "./screenshots/bug_001.jpg",
      timestamp: Date.now(),
    }];

    const section = buildBugSection(bugs);
    expect(section).toContain("![bug_001](./screenshots/bug_001.jpg)");
  });

  it("separates multiple bugs with a horizontal rule", () => {
    const bugs = [
      { id: "bug_001", severity: "high" as const, title: "A", description: "", screen: "S", timestamp: 1 },
      { id: "bug_002", severity: "high" as const, title: "B", description: "", screen: "S", timestamp: 2 },
    ];
    const section = buildBugSection(bugs);
    expect(section).toContain("---");
  });
});

// ── buildCoverageTable ─────────────────────────────────────────────────────────

describe("buildCoverageTable", () => {
  it("returns placeholder for empty node list", () => {
    expect(buildCoverageTable([])).toContain("No screens registered");
  });

  it("renders all registered screens", () => {
    registerScreen("LoginScreen");
    registerScreen("HomeScreen");
    markScreenTested("LoginScreen", "pass");
    markScreenTested("HomeScreen", "fail", "crash on load");

    const { nodes } = getGraph();
    const table = buildCoverageTable(nodes);

    expect(table).toContain("LoginScreen");
    expect(table).toContain("PASS");
    expect(table).toContain("HomeScreen");
    expect(table).toContain("FAIL");
    expect(table).toContain("crash on load");
  });

  it("shows UNTESTED for screens without a result", () => {
    registerScreen("SettingsScreen");
    const { nodes } = getGraph();
    const table = buildCoverageTable(nodes);
    expect(table).toContain("UNTESTED");
  });

  it("puts untested screens first", () => {
    registerScreen("Tested");
    markScreenTested("Tested", "pass");
    registerScreen("Untested");

    const { nodes } = getGraph();
    const table = buildCoverageTable(nodes);
    const untestedPos = table.indexOf("UNTESTED");
    const passPos = table.indexOf("PASS");
    expect(untestedPos).toBeLessThan(passPos);
  });
});

// ── buildRecommendations ───────────────────────────────────────────────────────

describe("buildRecommendations", () => {
  it("returns default message when no issues", () => {
    const rec = buildRecommendations(getStats(), []);
    expect(rec).toContain("No critical issues found");
  });

  it("flags crash bugs as must-fix before release", () => {
    addBug("critical", "App crashes on login", "desc", "LoginScreen");
    const rec = buildRecommendations(getStats(), [
      { id: "bug_001", severity: "critical", title: "App crashes on login", description: "", screen: "LoginScreen", timestamp: Date.now() }
    ]);
    expect(rec).toContain("Must fix before release");
    expect(rec).toContain("crashes on login");
  });

  it("mentions blocked screens", () => {
    registerScreen("Mystery");
    markScreenTested("Mystery", "blocked");
    const rec = buildRecommendations(getStats(), []);
    expect(rec).toContain("blocked");
  });

  it("flags low coverage", () => {
    // 1 discovered, 0 tested = 0% coverage
    registerScreen("Only");
    const rec = buildRecommendations(getStats(), []);
    expect(rec).toContain("0%");
  });

  it("groups high bugs together", () => {
    const bugs = [
      { id: "bug_001", severity: "high" as const, title: "Nav broken", description: "", screen: "S", timestamp: 1 },
      { id: "bug_002", severity: "high" as const, title: "Button missing", description: "", screen: "S", timestamp: 2 },
    ];
    const rec = buildRecommendations(getStats(), bugs);
    expect(rec).toContain("2 high-severity");
  });
});

// ── buildMarkdownReport ────────────────────────────────────────────────────────

describe("buildMarkdownReport", () => {
  beforeEach(() => {
    registerScreen("HomeScreen");
    registerScreen("LoginScreen");
    markScreenTested("HomeScreen", "pass");
    markScreenTested("LoginScreen", "fail", "crash");
    addBug("critical", "App crashes", "Tap login → crash", "LoginScreen");
    addEdge("LoginScreen", "HomeScreen", "tap Login");
  });

  it("contains the app name in the header", () => {
    const report = buildMarkdownReport("MyTestApp", "2.1.0");
    expect(report).toContain("# iOS Test Report — MyTestApp 2.1.0");
  });

  it("contains all four required sections", () => {
    const report = buildMarkdownReport();
    expect(report).toContain("## Summary");
    expect(report).toContain("## Bugs Found");
    expect(report).toContain("## Screen Coverage");
    expect(report).toContain("## Recommendations");
  });

  it("includes duration in the header line", () => {
    const report = buildMarkdownReport();
    expect(report).toContain("Duration:");
  });

  it("includes navigation edge count in coverage section", () => {
    const report = buildMarkdownReport();
    expect(report).toContain("Navigation edges recorded: 1");
  });

  it("defaults app name to 'Unknown App'", () => {
    const report = buildMarkdownReport();
    expect(report).toContain("Unknown App");
  });
});

// ── buildJsonReport ────────────────────────────────────────────────────────────

describe("buildJsonReport", () => {
  beforeEach(() => {
    registerScreen("Home");
    markScreenTested("Home", "pass");
    addBug("high", "Layout bug", "Overlap", "Home");
  });

  it("returns an object with expected top-level keys", () => {
    const json = buildJsonReport("MyApp", "1.0");
    expect(json).toHaveProperty("meta");
    expect(json).toHaveProperty("stats");
    expect(json).toHaveProperty("bugs");
    expect(json).toHaveProperty("screens");
    expect(json).toHaveProperty("graph");
    expect(json).toHaveProperty("recommendations");
  });

  it("includes app name and version in meta", () => {
    const json = buildJsonReport("SuperApp", "3.2.1") as Record<string, unknown>;
    const meta = json["meta"] as Record<string, unknown>;
    expect(meta["appName"]).toBe("SuperApp");
    expect(meta["appVersion"]).toBe("3.2.1");
  });

  it("recommendations is an array of strings", () => {
    const json = buildJsonReport() as Record<string, unknown>;
    expect(Array.isArray(json["recommendations"])).toBe(true);
    (json["recommendations"] as unknown[]).forEach((r) => {
      expect(typeof r).toBe("string");
    });
  });

  it("bugs include a human-readable timestamp", () => {
    const json = buildJsonReport() as Record<string, unknown>;
    const bugs = json["bugs"] as Array<Record<string, unknown>>;
    expect(bugs[0]).toHaveProperty("timestampFormatted");
    expect(typeof bugs[0]!["timestampFormatted"]).toBe("string");
  });
});

// ── generateReport ─────────────────────────────────────────────────────────────

describe("generateReport", () => {
  it("returns a markdown string for format=markdown", async () => {
    const output = await generateReport("markdown", "App", "1.0");
    expect(typeof output).toBe("string");
    expect(output).toContain("# iOS Test Report");
  });

  it("returns valid JSON for format=json", async () => {
    const output = await generateReport("json");
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty("stats");
  });
});
