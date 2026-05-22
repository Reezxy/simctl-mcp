import {
  registerScreen,
  markScreenTested,
  addEdge,
  addBug,
  getGraph,
  getBugs,
  getStats,
  hasVisitedTooManyTimes,
  resetGraph,
} from "../engine/screen-graph.js";

beforeEach(() => {
  resetGraph();
});

// ── registerScreen ─────────────────────────────────────────────────────────────

describe("registerScreen", () => {
  it("creates a new node with visitCount=1", () => {
    const node = registerScreen("HomeScreen", "Main tab bar screen");
    expect(node.name).toBe("HomeScreen");
    expect(node.description).toBe("Main tab bar screen");
    expect(node.visitCount).toBe(1);
    expect(node.result).toBeUndefined();
    expect(node.discoveredAt).toBeGreaterThan(0);
  });

  it("increments visitCount on subsequent registrations", () => {
    registerScreen("HomeScreen");
    registerScreen("HomeScreen");
    const node = registerScreen("HomeScreen");
    expect(node.visitCount).toBe(3);
  });

  it("sets description only if not already set", () => {
    registerScreen("HomeScreen", "first description");
    const node = registerScreen("HomeScreen", "second description");
    expect(node.description).toBe("first description");
  });

  it("registers multiple distinct screens", () => {
    registerScreen("Screen A");
    registerScreen("Screen B");
    registerScreen("Screen C");
    expect(getGraph().nodes).toHaveLength(3);
  });
});

// ── markScreenTested ───────────────────────────────────────────────────────────

describe("markScreenTested", () => {
  it("sets result and notes on an existing node", () => {
    registerScreen("LoginScreen");
    const node = markScreenTested("LoginScreen", "pass", "all fields validated");
    expect(node.result).toBe("pass");
    expect(node.notes).toBe("all fields validated");
  });

  it("auto-registers the screen if not yet seen", () => {
    const node = markScreenTested("NewScreen", "skip", "not reachable");
    expect(node.name).toBe("NewScreen");
    expect(node.visitCount).toBe(1);
  });

  it("overwrites a previous result", () => {
    registerScreen("Checkout");
    markScreenTested("Checkout", "pass");
    const node = markScreenTested("Checkout", "fail", "crash on submit");
    expect(node.result).toBe("fail");
  });
});

// ── hasVisitedTooManyTimes ─────────────────────────────────────────────────────

describe("hasVisitedTooManyTimes", () => {
  it("returns false when screen has not been registered", () => {
    expect(hasVisitedTooManyTimes("Unknown")).toBe(false);
  });

  it("returns false for visitCount below default threshold (2)", () => {
    registerScreen("Screen");
    expect(hasVisitedTooManyTimes("Screen")).toBe(false);
  });

  it("returns true when visitCount reaches the default threshold (2)", () => {
    registerScreen("Screen");
    registerScreen("Screen");
    expect(hasVisitedTooManyTimes("Screen")).toBe(true);
  });

  it("respects a custom maxVisits threshold", () => {
    registerScreen("Screen");
    registerScreen("Screen");
    expect(hasVisitedTooManyTimes("Screen", 3)).toBe(false);
    registerScreen("Screen");
    expect(hasVisitedTooManyTimes("Screen", 3)).toBe(true);
  });
});

// ── addEdge ────────────────────────────────────────────────────────────────────

describe("addEdge", () => {
  it("adds a directed edge to the graph", () => {
    addEdge("Home", "Profile", "tap avatar");
    const { edges } = getGraph();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: "Home", to: "Profile", action: "tap avatar" });
  });

  it("does not add duplicate edges", () => {
    addEdge("Home", "Profile", "tap avatar");
    addEdge("Home", "Profile", "tap avatar");
    expect(getGraph().edges).toHaveLength(1);
  });

  it("allows the same nodes with a different action", () => {
    addEdge("Home", "Profile", "tap avatar");
    addEdge("Home", "Profile", "long press avatar");
    expect(getGraph().edges).toHaveLength(2);
  });

  it("allows same action between different node pairs", () => {
    addEdge("A", "B", "tap Next");
    addEdge("B", "C", "tap Next");
    expect(getGraph().edges).toHaveLength(2);
  });
});

// ── addBug ─────────────────────────────────────────────────────────────────────

describe("addBug", () => {
  it("assigns sequential IDs starting at bug_001", () => {
    const b1 = addBug("critical", "Crash on login", "desc", "LoginScreen");
    const b2 = addBug("high", "Button missing", "desc", "HomeScreen");
    expect(b1.id).toBe("bug_001");
    expect(b2.id).toBe("bug_002");
  });

  it("stores all provided fields", () => {
    const bug = addBug(
      "medium",
      "Layout broken",
      "Nav bar overlaps content",
      "ProfileScreen",
      "/screenshots/bug_001.jpg",
      "Error: constraint violation"
    );
    expect(bug.severity).toBe("medium");
    expect(bug.title).toBe("Layout broken");
    expect(bug.screen).toBe("ProfileScreen");
    expect(bug.screenshotPath).toBe("/screenshots/bug_001.jpg");
    expect(bug.logExcerpt).toBe("Error: constraint violation");
    expect(bug.timestamp).toBeGreaterThan(0);
  });

  it("optional fields default to undefined", () => {
    const bug = addBug("low", "Typo", "small typo in label", "AboutScreen");
    expect(bug.screenshotPath).toBeUndefined();
    expect(bug.logExcerpt).toBeUndefined();
  });

  it("resets counter after resetGraph", () => {
    addBug("low", "Bug A", "", "Screen");
    resetGraph();
    const bug = addBug("low", "Bug B", "", "Screen");
    expect(bug.id).toBe("bug_001");
  });
});

// ── getStats ───────────────────────────────────────────────────────────────────

describe("getStats", () => {
  it("returns zeros for an empty session", () => {
    const stats = getStats();
    expect(stats.screensDiscovered).toBe(0);
    expect(stats.totalBugs).toBe(0);
    expect(stats.coveragePercent).toBe(0);
  });

  it("calculates coverage as tested/discovered", () => {
    registerScreen("A");
    registerScreen("B");
    registerScreen("C");
    markScreenTested("A", "pass");
    markScreenTested("B", "fail");

    const stats = getStats();
    expect(stats.screensDiscovered).toBe(3);
    expect(stats.screensTested).toBe(2);
    expect(stats.coveragePercent).toBe(67); // round(2/3 * 100)
  });

  it("counts bugs by severity", () => {
    addBug("critical", "Crash", "", "S");
    addBug("high", "Bug", "", "S");
    addBug("high", "Bug2", "", "S");
    addBug("low", "Minor", "", "S");

    const stats = getStats();
    expect(stats.bugsByCritical).toBe(1);
    expect(stats.bugsByHigh).toBe(2);
    expect(stats.bugsByMedium).toBe(0);
    expect(stats.bugsByLow).toBe(1);
    expect(stats.totalBugs).toBe(4);
  });

  it("counts blocked screens separately", () => {
    registerScreen("A");
    registerScreen("B");
    markScreenTested("A", "pass");
    markScreenTested("B", "blocked");

    const stats = getStats();
    expect(stats.screensBlocked).toBe(1);
    expect(stats.screensTested).toBe(2); // blocked is still "tested"
  });

  it("tracks session duration", async () => {
    await new Promise((r) => setTimeout(r, 10));
    const stats = getStats();
    expect(stats.durationMs).toBeGreaterThanOrEqual(10);
  });
});

// ── getGraph ───────────────────────────────────────────────────────────────────

describe("getGraph", () => {
  it("returns copies, not references", () => {
    registerScreen("Home");
    addEdge("Home", "Profile", "tap");

    const g1 = getGraph();
    registerScreen("Settings");
    const g2 = getGraph();

    // g1 should not reflect the later registerScreen
    expect(g1.nodes).toHaveLength(1);
    expect(g2.nodes).toHaveLength(2);
  });
});

// ── resetGraph ─────────────────────────────────────────────────────────────────

describe("resetGraph", () => {
  it("clears all nodes, edges, and bugs", () => {
    registerScreen("A");
    addEdge("A", "B", "tap");
    addBug("low", "x", "", "A");
    resetGraph();

    expect(getGraph().nodes).toHaveLength(0);
    expect(getGraph().edges).toHaveLength(0);
    expect(getBugs()).toHaveLength(0);
  });
});
