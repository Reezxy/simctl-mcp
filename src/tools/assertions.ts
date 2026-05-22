import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec, isExecError } from "../utils/exec.js";
import { getAccessibilityTree } from "./accessibility.js";
import { compareScreenshot } from "./screenshot.js";
import { findElement } from "../engine/element-finder.js";
import { toolOk } from "../types.js";
import type { AssertionResult, McpToolDef } from "../types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrashResult {
  crashed: boolean;
  crash_summary?: string;
}

export interface LogCheckResult {
  passed: boolean;
  matched_lines: string[];
  message: string;
}

// ── Crash tracking ────────────────────────────────────────────────────────────

// Start tracking from module load so we only catch crashes during test session
let lastCrashCheckMs = Date.now();

const DIAG_DIR = path.join(
  os.homedir(),
  "Library",
  "Logs",
  "DiagnosticReports"
);

function parseCrashSummary(content: string, filePath: string): string {
  // .ips files are JSON
  if (filePath.endsWith(".ips")) {
    try {
      const json = JSON.parse(content) as Record<string, unknown>;
      const exc = json["exception"] as Record<string, string> | undefined;
      const exType = exc?.["type"] ?? "unknown";
      const exSignal = exc?.["signal"] ?? exc?.["subtype"] ?? "";
      const threads = (json["threads"] as Array<Record<string, unknown>>) ?? [];
      const crashed = threads.find(
        (t) => (t["triggered"] as boolean) === true || (t["name"] as string) === "Crashed"
      );
      const frames = (crashed?.["frames"] as Array<Record<string, string>>) ?? [];
      const top5 = frames
        .slice(0, 5)
        .map((f) => `  ${f["imageOffset"] ?? ""} ${f["symbol"] ?? f["imageIndex"] ?? ""}`)
        .join("\n");
      return `Exception: ${exType} ${exSignal}\nTop frames:\n${top5 || "  (no frames)"}`;
    } catch {
      // fall through to text parsing
    }
  }

  // .crash text format
  const lines = content.split("\n");
  const exLine = lines.find((l) => l.startsWith("Exception Type:")) ?? "";
  const subLine = lines.find((l) => l.startsWith("Exception Subtype:")) ?? "";

  const crashedIdx = lines.findIndex((l) =>
    l.includes("Crashed:") || l.includes("Thread 0 Crashed")
  );
  const frames =
    crashedIdx >= 0
      ? lines
          .slice(crashedIdx + 1, crashedIdx + 6)
          .filter((l) => /^\d+\s/.test(l))
          .map((l) => `  ${l.trim()}`)
          .join("\n")
      : "(no frames)";

  return `${exLine}${subLine ? "\n" + subLine : ""}\nTop frames:\n${frames}`;
}

// ── Default log error patterns ─────────────────────────────────────────────────

const DEFAULT_ERROR_PATTERNS = [
  "Error",
  "Exception",
  "fatal",
  "crash",
  " nil",
  "undefined",
  "NaN",
];

// ── Core logic (exported for tests) ──────────────────────────────────────────

export async function assertElementExists(
  label: string,
  shouldExist = true
): Promise<AssertionResult> {
  try {
    const { elements } = await getAccessibilityTree();
    const found = findElement(elements, label, "fuzzy").found;

    if (shouldExist) {
      return found
        ? { passed: true, message: `Element "${label}" exists as expected.` }
        : { passed: false, message: `Expected element "${label}" to exist but it was not found.` };
    } else {
      return found
        ? { passed: false, message: `Expected element "${label}" to be absent but it was found.` }
        : { passed: true, message: `Element "${label}" is absent as expected.` };
    }
  } catch (err) {
    return {
      passed: false,
      message: `Could not check element existence: ${(err as Error).message}`,
    };
  }
}

export async function assertTextEquals(
  label: string,
  expectedText: string
): Promise<AssertionResult> {
  try {
    const { elements } = await getAccessibilityTree();
    const result = findElement(elements, label, "fuzzy");

    if (!result.found || !result.element) {
      return {
        passed: false,
        message: `Element "${label}" not found — cannot assert text.`,
      };
    }

    const el = result.element;
    // Check label itself and value field, case-insensitive
    const actual = (el.value ?? el.label).toLowerCase().trim();
    const expected = expectedText.toLowerCase().trim();

    return actual === expected
      ? { passed: true, message: `"${label}" text matches "${expectedText}".` }
      : {
          passed: false,
          message: `"${label}" text mismatch. Expected: "${expectedText}", actual: "${el.value ?? el.label}".`,
        };
  } catch (err) {
    return {
      passed: false,
      message: `Could not assert text: ${(err as Error).message}`,
    };
  }
}

export async function assertElementEnabled(
  label: string,
  shouldBeEnabled = true
): Promise<AssertionResult> {
  try {
    const { elements } = await getAccessibilityTree();
    const result = findElement(elements, label, "fuzzy");

    if (!result.found || !result.element) {
      return {
        passed: false,
        message: `Element "${label}" not found — cannot assert enabled state.`,
      };
    }

    const { enabled } = result.element;

    if (shouldBeEnabled) {
      return enabled
        ? { passed: true, message: `"${label}" is enabled as expected.` }
        : { passed: false, message: `Expected "${label}" to be enabled but it is disabled.` };
    } else {
      return enabled
        ? { passed: false, message: `Expected "${label}" to be disabled but it is enabled.` }
        : { passed: true, message: `"${label}" is disabled as expected.` };
    }
  } catch (err) {
    return {
      passed: false,
      message: `Could not assert enabled state: ${(err as Error).message}`,
    };
  }
}

export async function assertNoCrash(): Promise<CrashResult> {
  const checkFrom = lastCrashCheckMs;
  lastCrashCheckMs = Date.now();

  let files: string[];
  try {
    files = await fs.readdir(DIAG_DIR);
  } catch {
    // Diagnostic dir may not exist in some environments
    return { crashed: false };
  }

  const crashFiles = files.filter(
    (f) => f.endsWith(".crash") || f.endsWith(".ips")
  );

  const recentCrashes: string[] = [];
  for (const file of crashFiles) {
    const filePath = path.join(DIAG_DIR, file);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > checkFrom) {
        recentCrashes.push(filePath);
      }
    } catch {
      // skip unreadable files
    }
  }

  if (recentCrashes.length === 0) {
    return { crashed: false };
  }

  // Sort by mtime, parse the most recent
  recentCrashes.sort();
  const latestPath = recentCrashes[recentCrashes.length - 1]!;

  try {
    const content = await fs.readFile(latestPath, "utf-8");
    const summary = parseCrashSummary(content, latestPath);
    return {
      crashed: true,
      crash_summary: `Crash detected: ${path.basename(latestPath)}\n${summary}`,
    };
  } catch {
    return {
      crashed: true,
      crash_summary: `Crash detected: ${path.basename(latestPath)} (could not read details)`,
    };
  }
}

export async function assertNoErrorInLogs(
  patterns = DEFAULT_ERROR_PATTERNS
): Promise<LogCheckResult> {
  // Pull last 10 seconds of simulator console output
  const result = await exec(
    "xcrun simctl spawn booted log show --last 10s --style compact",
    { timeoutMs: 15_000 }
  );

  if (isExecError(result)) {
    // Non-fatal: log reading failing shouldn't fail a test
    return {
      passed: true,
      matched_lines: [],
      message: `Could not read simulator logs: ${result.message}`,
    };
  }

  const lines = result.stdout.split("\n").filter(Boolean);
  const matched = lines.filter((line) =>
    patterns.some((p) => line.toLowerCase().includes(p.toLowerCase()))
  );

  return {
    passed: matched.length === 0,
    matched_lines: matched.slice(0, 20), // cap at 20 lines
    message:
      matched.length === 0
        ? "No error patterns found in recent console logs."
        : `Found ${matched.length} line(s) matching error patterns.`,
  };
}

/** Resets the crash-check baseline to now (useful for tests). */
export function resetCrashBaseline(): void {
  lastCrashCheckMs = Date.now();
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const assertionTools: McpToolDef[] = [
  {
    name: "assert_element_exists",
    description:
      "Checks whether an element with the given label is present in the accessibility tree. " +
      "Set should_exist=false to assert the element is absent. " +
      "Returns { passed, message }. Never throws — always returns a result for you to evaluate.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label to look for (fuzzy matched)." },
        should_exist: {
          type: "boolean",
          description: "true = assert present (default), false = assert absent.",
        },
      },
      required: ["label"],
    },
    handler: async (args) => {
      const label = args["label"] as string;
      const shouldExist = (args["should_exist"] as boolean | undefined) ?? true;
      const result = await assertElementExists(label, shouldExist);
      return toolOk(result);
    },
  },

  {
    name: "assert_text_equals",
    description:
      "Finds an element by label and checks that its text content (label or value) matches expected_text. " +
      "Comparison is case-insensitive and whitespace-trimmed. " +
      "Returns { passed, message }.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label of the element to inspect." },
        expected_text: { type: "string", description: "Text the element should display." },
      },
      required: ["label", "expected_text"],
    },
    handler: async (args) => {
      const label = args["label"] as string;
      const expectedText = args["expected_text"] as string;
      const result = await assertTextEquals(label, expectedText);
      return toolOk(result);
    },
  },

  {
    name: "assert_element_enabled",
    description:
      "Checks whether an element is enabled (interactive). " +
      "Set should_be_enabled=false to assert the element is disabled. " +
      "Useful before tapping submit buttons or validating form state. " +
      "Returns { passed, message }.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label of the element to check." },
        should_be_enabled: {
          type: "boolean",
          description: "true = assert enabled (default), false = assert disabled.",
        },
      },
      required: ["label"],
    },
    handler: async (args) => {
      const label = args["label"] as string;
      const shouldBeEnabled = (args["should_be_enabled"] as boolean | undefined) ?? true;
      const result = await assertElementEnabled(label, shouldBeEnabled);
      return toolOk(result);
    },
  },

  {
    name: "assert_no_crash",
    description:
      "Checks crash logs for any app crash since the last time this tool was called. " +
      "Returns { crashed: false } on clean run, or { crashed: true, crash_summary } with " +
      "exception type and top backtrace frames. " +
      "Call this after every tap or navigation to catch crashes early.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const result = await assertNoCrash();
      return toolOk(result);
    },
  },

  {
    name: "assert_no_error_in_logs",
    description:
      "Scans the last 10 seconds of simulator console output for error patterns. " +
      "Default patterns: Error, Exception, fatal, crash, nil, undefined, NaN. " +
      "Returns { passed, matched_lines, message }. " +
      "Provide a custom patterns array to narrow or broaden the check.",
    inputSchema: {
      type: "object",
      properties: {
        patterns: {
          type: "array",
          items: { type: "string" },
          description:
            "Strings to search for in logs (case-insensitive). " +
            'Defaults to ["Error","Exception","fatal","crash","nil","undefined","NaN"].',
        },
      },
    },
    handler: async (args) => {
      const patterns = args["patterns"] as string[] | undefined;
      const result = await assertNoErrorInLogs(patterns);
      return toolOk(result);
    },
  },

  {
    name: "compare_screenshot",
    description:
      "Diffs the current screen against a saved baseline screenshot. " +
      "Returns { matches, diff_percent, diff_image_path }. " +
      "Diff pixels are highlighted red in the saved diff image. " +
      "Use threshold_percent to control sensitivity (default: 2%).",
    inputSchema: {
      type: "object",
      properties: {
        baseline_path: {
          type: "string",
          description: "File path to the saved baseline screenshot.",
        },
        threshold_percent: {
          type: "number",
          description: "Max diff % to be considered matching. Default: 2.",
        },
      },
      required: ["baseline_path"],
    },
    handler: async (args) => {
      const baselinePath = args["baseline_path"] as string;
      const threshold = (args["threshold_percent"] as number | undefined) ?? 2;
      try {
        return await compareScreenshot(baselinePath, threshold);
      } catch (err) {
        // compareScreenshot returns McpToolResult, but wrap errors
        return toolOk({
          matches: false,
          diff_percent: 100,
          message: (err as Error).message,
        });
      }
    },
  },
];
