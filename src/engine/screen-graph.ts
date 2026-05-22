import type { Bug, ScreenEdge, ScreenNode, TestResult } from "../types.js";

// ── In-process singleton state ─────────────────────────────────────────────────

const nodes = new Map<string, ScreenNode>();
const edges: ScreenEdge[] = [];
const bugs: Bug[] = [];
let bugCounter = 0;
let sessionStartMs = Date.now();

// ── Screen nodes ───────────────────────────────────────────────────────────────

/**
 * Registers a screen or increments its visit count if already known.
 * Returns the (possibly updated) node.
 */
export function registerScreen(
  name: string,
  description?: string
): ScreenNode {
  const existing = nodes.get(name);
  if (existing) {
    existing.visitCount++;
    if (description && !existing.description) {
      existing.description = description;
    }
    return existing;
  }

  const node: ScreenNode = {
    name,
    description,
    visitCount: 1,
    discoveredAt: Date.now(),
  };
  nodes.set(name, node);
  return node;
}

/**
 * Records the test outcome for a screen.
 */
export function markScreenTested(
  name: string,
  result: TestResult,
  notes?: string
): ScreenNode {
  let node = nodes.get(name);
  if (!node) {
    // Auto-register if not yet seen
    node = registerScreen(name);
  }
  node.result = result;
  if (notes) node.notes = notes;
  return node;
}

/**
 * Returns true when a screen has been visited `maxVisits` or more times,
 * indicating the loop-prevention limit has been reached.
 */
export function hasVisitedTooManyTimes(
  name: string,
  maxVisits = 2
): boolean {
  const node = nodes.get(name);
  return node !== undefined && node.visitCount >= maxVisits;
}

// ── Edges ──────────────────────────────────────────────────────────────────────

/**
 * Records a navigation transition in the graph.
 * Skips duplicate edges (same from → to via same action).
 */
export function addEdge(from: string, to: string, action: string): void {
  const exists = edges.some(
    (e) => e.from === from && e.to === to && e.action === action
  );
  if (!exists) {
    edges.push({ from, to, action });
  }
}

// ── Bugs ───────────────────────────────────────────────────────────────────────

/**
 * Adds a bug to the report.  Returns the created Bug with a unique ID.
 */
export function addBug(
  severity: Bug["severity"],
  title: string,
  description: string,
  screen: string,
  screenshotPath?: string,
  logExcerpt?: string
): Bug {
  bugCounter++;
  const bug: Bug = {
    id: `bug_${String(bugCounter).padStart(3, "0")}`,
    severity,
    title,
    description,
    screen,
    screenshotPath,
    logExcerpt,
    timestamp: Date.now(),
  };
  bugs.push(bug);
  return bug;
}

// ── Read-only views ────────────────────────────────────────────────────────────

export interface ScreenGraph {
  nodes: ScreenNode[];
  edges: ScreenEdge[];
}

export function getGraph(): ScreenGraph {
  return {
    nodes: Array.from(nodes.values()),
    edges: [...edges],
  };
}

export function getBugs(): Bug[] {
  return [...bugs];
}

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

export function getStats(): SessionStats {
  const all = Array.from(nodes.values());
  const tested = all.filter((n) => n.result !== undefined);
  const passed = all.filter((n) => n.result === "pass").length;
  const failed = all.filter((n) => n.result === "fail").length;
  const skipped = all.filter((n) => n.result === "skip").length;
  const blocked = all.filter((n) => n.result === "blocked").length;

  const coverage =
    all.length > 0 ? Math.round((tested.length / all.length) * 100) : 0;

  const bugCount = (s: Bug["severity"]) =>
    bugs.filter((b) => b.severity === s).length;

  const crashBugs = bugs.filter((b) =>
    b.title.toLowerCase().includes("crash")
  ).length;

  return {
    sessionStartMs,
    durationMs: Date.now() - sessionStartMs,
    screensDiscovered: all.length,
    screensTested: tested.length,
    screensBlocked: blocked,
    screensPassed: passed,
    screensFailed: failed,
    screensSkipped: skipped,
    coveragePercent: coverage,
    bugsByCritical: bugCount("critical"),
    bugsByHigh: bugCount("high"),
    bugsByMedium: bugCount("medium"),
    bugsByLow: bugCount("low"),
    totalBugs: bugs.length,
    crashes: crashBugs,
  };
}

/**
 * Resets all state — used for tests and new test sessions.
 */
export function resetGraph(): void {
  nodes.clear();
  edges.length = 0;
  bugs.length = 0;
  bugCounter = 0;
  sessionStartMs = Date.now();
}
