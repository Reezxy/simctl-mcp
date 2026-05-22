import { jest } from "@jest/globals";
import type { UIElement } from "../types.js";
import type { ExecResponse } from "../utils/exec.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetAccessibilityTree = jest.fn<
  () => Promise<{ elements: UIElement[]; truncated: boolean; totalCount: number }>
>();
jest.unstable_mockModule("../tools/accessibility.js", () => ({
  getAccessibilityTree: mockGetAccessibilityTree,
  describeCurrentScreen: jest.fn(),
  accessibilityTools: [],
}));

const mockCompareScreenshot = jest.fn<
  () => Promise<{ content: Array<{ type: string; text: string }> }>
>();
jest.unstable_mockModule("../tools/screenshot.js", () => ({
  captureRawPng: jest.fn(),
  takeScreenshot: jest.fn(),
  compareScreenshot: mockCompareScreenshot,
  screenshotTools: [],
}));

const mockExec = jest.fn<() => Promise<ExecResponse>>();
jest.unstable_mockModule("../utils/exec.js", () => ({
  exec: mockExec,
  execOrThrow: jest.fn(),
  isExecError: (r: unknown) =>
    typeof r === "object" && r !== null && "error" in r,
}));

// fs mock for crash log tests
const mockReaddir = jest.fn<() => Promise<string[]>>();
const mockStat = jest.fn<() => Promise<{ mtimeMs: number }>>();
const mockReadFile = jest.fn<() => Promise<string>>();
jest.unstable_mockModule("fs/promises", () => ({
  readdir: mockReaddir,
  stat: mockStat,
  readFile: mockReadFile,
  unlink: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mkdir: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  writeFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  access: jest.fn(),
}));

const {
  assertElementExists,
  assertTextEquals,
  assertElementEnabled,
  assertNoCrash,
  assertNoErrorInLogs,
  resetCrashBaseline,
} = await import("../tools/assertions.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(
  label: string,
  type = "Button",
  opts: Partial<UIElement> = {}
): UIElement {
  return {
    label,
    type,
    value: opts.value,
    frame: { x: 0, y: 0, width: 80, height: 44 },
    enabled: opts.enabled ?? true,
    visible: opts.visible ?? true,
    depth: 1,
    children_count: 0,
  };
}

function tree(...elements: UIElement[]) {
  return { elements, truncated: false, totalCount: elements.length };
}

const execOk = (stdout = ""): ExecResponse => ({ stdout, stderr: "" });
const execErr = (msg = "failed"): ExecResponse => ({
  error: true as const,
  message: msg,
  command: "",
});

beforeEach(() => {
  mockGetAccessibilityTree.mockReset();
  mockExec.mockReset();
  mockReaddir.mockReset();
  mockStat.mockReset();
  mockReadFile.mockReset();
  resetCrashBaseline();
});

// ── assertElementExists ────────────────────────────────────────────────────────

describe("assertElementExists", () => {
  it("passes when element is found and should_exist=true", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("Submit")));
    const r = await assertElementExists("Submit", true);
    expect(r.passed).toBe(true);
    expect(r.message).toContain("exists");
  });

  it("fails when element is missing and should_exist=true", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("Home")));
    const r = await assertElementExists("Submit", true);
    expect(r.passed).toBe(false);
    expect(r.message).toContain("not found");
  });

  it("passes when element is absent and should_exist=false", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("Home")));
    const r = await assertElementExists("Submit", false);
    expect(r.passed).toBe(true);
    expect(r.message).toContain("absent");
  });

  it("fails when element is present and should_exist=false", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("Submit")));
    const r = await assertElementExists("Submit", false);
    expect(r.passed).toBe(false);
    expect(r.message).toContain("found");
  });

  it("defaults should_exist to true", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("OK")));
    const r = await assertElementExists("OK");
    expect(r.passed).toBe(true);
  });

  it("never throws — returns passed=false on accessibility error", async () => {
    mockGetAccessibilityTree.mockRejectedValue(new Error("idb not found"));
    const r = await assertElementExists("Anything");
    expect(r.passed).toBe(false);
    expect(r.message).toContain("idb not found");
  });
});

// ── assertTextEquals ───────────────────────────────────────────────────────────

describe("assertTextEquals", () => {
  it("passes on exact case-insensitive match", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Price", "StaticText", { value: "$9.99" }))
    );
    const r = await assertTextEquals("Price", "$9.99");
    expect(r.passed).toBe(true);
  });

  it("is case-insensitive", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Status", "StaticText", { value: "Active" }))
    );
    const r = await assertTextEquals("Status", "ACTIVE");
    expect(r.passed).toBe(true);
  });

  it("fails on mismatch and reports actual vs expected", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Title", "StaticText", { value: "Welcome" }))
    );
    const r = await assertTextEquals("Title", "Goodbye");
    expect(r.passed).toBe(false);
    expect(r.message).toContain("Goodbye");
    expect(r.message).toContain("Welcome");
  });

  it("falls back to checking the label when value is absent", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Confirm Order", "Button"))
    );
    const r = await assertTextEquals("Confirm Order", "Confirm Order");
    expect(r.passed).toBe(true);
  });

  it("fails when element is not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("Other")));
    const r = await assertTextEquals("Price", "$9.99");
    expect(r.passed).toBe(false);
    expect(r.message).toContain("not found");
  });

  it("never throws on accessibility error", async () => {
    mockGetAccessibilityTree.mockRejectedValue(new Error("timeout"));
    const r = await assertTextEquals("label", "val");
    expect(r.passed).toBe(false);
    expect(r.message).toContain("timeout");
  });
});

// ── assertElementEnabled ───────────────────────────────────────────────────────

describe("assertElementEnabled", () => {
  it("passes when element is enabled and should_be_enabled=true", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Submit", "Button", { enabled: true }))
    );
    const r = await assertElementEnabled("Submit", true);
    expect(r.passed).toBe(true);
  });

  it("fails when element is disabled and should_be_enabled=true", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Submit", "Button", { enabled: false }))
    );
    const r = await assertElementEnabled("Submit", true);
    expect(r.passed).toBe(false);
    expect(r.message).toContain("disabled");
  });

  it("passes when element is disabled and should_be_enabled=false", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Submit", "Button", { enabled: false }))
    );
    const r = await assertElementEnabled("Submit", false);
    expect(r.passed).toBe(true);
  });

  it("fails when element is not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree(el("Home")));
    const r = await assertElementEnabled("Ghost Button");
    expect(r.passed).toBe(false);
    expect(r.message).toContain("not found");
  });

  it("defaults should_be_enabled to true", async () => {
    mockGetAccessibilityTree.mockResolvedValue(
      tree(el("Go", "Button", { enabled: true }))
    );
    const r = await assertElementEnabled("Go");
    expect(r.passed).toBe(true);
  });
});

// ── assertNoCrash ──────────────────────────────────────────────────────────────

describe("assertNoCrash", () => {
  it("returns crashed=false when no new crash files exist", async () => {
    mockReaddir.mockResolvedValue(["OldCrash.crash"]);
    // File modified BEFORE the check baseline → not a new crash
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60_000 });

    const r = await assertNoCrash();
    expect(r.crashed).toBe(false);
  });

  it("returns crashed=true with summary when new .crash file exists", async () => {
    mockReaddir.mockResolvedValue(["MyApp.crash"]);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() + 1_000 }); // future = newer

    const crashContent = [
      "Process:               MyApp [12345]",
      "Exception Type:        EXC_BAD_ACCESS (SIGSEGV)",
      "Exception Subtype:     SIGSEGV at 0x0",
      "",
      "Thread 0 Crashed:",
      "0   libswiftCore.dylib    0x1234 swift_retain + 10",
      "1   MyApp                 0x5678 doSomething + 100",
    ].join("\n");

    mockReadFile.mockResolvedValue(crashContent);

    const r = await assertNoCrash();
    expect(r.crashed).toBe(true);
    expect(r.crash_summary).toContain("EXC_BAD_ACCESS");
    expect(r.crash_summary).toContain("swift_retain");
  });

  it("returns crashed=true with summary when new .ips JSON file exists", async () => {
    mockReaddir.mockResolvedValue(["MyApp.ips"]);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() + 1_000 });

    const ipsContent = JSON.stringify({
      exception: { type: "EXC_CRASH", signal: "Abort trap: 6" },
      threads: [
        {
          triggered: true,
          frames: [
            { symbol: "abort_with_payload + 8", imageOffset: "0" },
            { symbol: "swift_fatalError + 10", imageOffset: "1" },
          ],
        },
      ],
    });

    mockReadFile.mockResolvedValue(ipsContent);

    const r = await assertNoCrash();
    expect(r.crashed).toBe(true);
    expect(r.crash_summary).toContain("EXC_CRASH");
    expect(r.crash_summary).toContain("abort_with_payload");
  });

  it("returns crashed=false when diagnostic dir does not exist", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    const r = await assertNoCrash();
    expect(r.crashed).toBe(false);
  });
});

// ── assertNoErrorInLogs ────────────────────────────────────────────────────────

describe("assertNoErrorInLogs", () => {
  it("passes when no error patterns are found", async () => {
    mockExec.mockResolvedValue(execOk("2024-01-01 Info: App started\n2024-01-01 Debug: user tapped"));
    const r = await assertNoErrorInLogs();
    expect(r.passed).toBe(true);
    expect(r.matched_lines).toHaveLength(0);
  });

  it("fails and returns matched lines when error patterns found", async () => {
    const logs = [
      "2024-01-01 Info: request sent",
      "2024-01-01 Error: network timeout",
      "2024-01-01 fatal: nil value unwrapped",
    ].join("\n");
    mockExec.mockResolvedValue(execOk(logs));
    const r = await assertNoErrorInLogs();
    expect(r.passed).toBe(false);
    expect(r.matched_lines).toHaveLength(2);
    expect(r.matched_lines[0]).toContain("Error: network timeout");
  });

  it("uses custom patterns when provided", async () => {
    const logs = "2024-01-01 PAYMENT_FAILED: card declined";
    mockExec.mockResolvedValue(execOk(logs));
    const r = await assertNoErrorInLogs(["PAYMENT_FAILED"]);
    expect(r.passed).toBe(false);
    expect(r.matched_lines[0]).toContain("PAYMENT_FAILED");
  });

  it("passes gracefully when log command fails", async () => {
    mockExec.mockResolvedValue(execErr("no booted device"));
    const r = await assertNoErrorInLogs();
    expect(r.passed).toBe(true); // non-fatal
    expect(r.message).toContain("Could not read");
  });

  it("caps matched lines at 20", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Error: line ${i}`).join("\n");
    mockExec.mockResolvedValue(execOk(lines));
    const r = await assertNoErrorInLogs();
    expect(r.matched_lines.length).toBeLessThanOrEqual(20);
  });
});
