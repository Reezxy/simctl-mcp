import { jest } from "@jest/globals";
import type { ExecResponse } from "../utils/exec.js";

const mockExec = jest.fn<() => Promise<ExecResponse>>();
jest.unstable_mockModule("../utils/exec.js", () => ({
  exec: mockExec,
  execOrThrow: jest.fn(),
  isExecError: (r: unknown) =>
    typeof r === "object" && r !== null && "error" in r,
}));

const mockReaddir = jest.fn<() => Promise<string[]>>();
const mockReadFile = jest.fn<() => Promise<string>>();
const mockStat = jest.fn<() => Promise<{ mtimeMs: number }>>();
jest.unstable_mockModule("fs/promises", () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  unlink: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mkdir: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  writeFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  access: jest.fn(),
}));

// Mock mock-server state
jest.unstable_mockModule("../../mock-server/state.js", () => ({
  mockServerState: {
    running: false,
    port: null,
    requests: [],
    stop: null,
  },
}));

const { getConsoleLogs, getCrashLogs, getNetworkCalls } =
  await import("../tools/diagnostics.js");

const ok = (stdout = ""): ExecResponse => ({ stdout, stderr: "" });
const execErr = (msg = "failed"): ExecResponse => ({
  error: true as const,
  message: msg,
  command: "",
});

beforeEach(() => {
  mockExec.mockReset();
  mockReaddir.mockReset();
  mockReadFile.mockReset();
  mockStat.mockReset();
});

// ── getConsoleLogs ─────────────────────────────────────────────────────────────

describe("getConsoleLogs", () => {
  it("returns the last N lines", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    mockExec.mockResolvedValue(ok(lines));

    const result = await getConsoleLogs(50);
    expect(result).toHaveLength(50);
    expect(result[0]).toBe("line 150"); // last 50 of 200
  });

  it("filters lines by search string (case-insensitive)", async () => {
    const logs = [
      "2024-01-01 Info: App started",
      "2024-01-01 Error: network failed",
      "2024-01-01 Debug: user tapped",
      "2024-01-01 Error: timeout",
    ].join("\n");
    mockExec.mockResolvedValue(ok(logs));

    const result = await getConsoleLogs(100, "error");
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Error: network failed");
  });

  it("throws when log command fails", async () => {
    mockExec.mockResolvedValue(execErr("no booted device"));
    await expect(getConsoleLogs()).rejects.toThrow("Could not read console logs");
  });
});

// ── getCrashLogs ───────────────────────────────────────────────────────────────

describe("getCrashLogs", () => {
  it("returns empty array when diagnostic dir is missing", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    const result = await getCrashLogs();
    expect(result).toHaveLength(0);
  });

  it("parses .crash text files", async () => {
    mockReaddir.mockResolvedValue(["MyApp.crash"]);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() });
    mockReadFile.mockResolvedValue([
      "Process:               MyApp [12345]",
      "Exception Type:        EXC_BAD_ACCESS (SIGSEGV)",
      "Exception Subtype:     SIGSEGV at 0x0",
      "",
      "Thread 0 Crashed:",
      "0   libswiftCore.dylib    0x1234 swift_retain + 10",
    ].join("\n"));

    const result = await getCrashLogs();
    expect(result).toHaveLength(1);
    expect(result[0]!.exceptionType).toContain("EXC_BAD_ACCESS");
    expect(result[0]!.topFrames[0]).toContain("swift_retain");
  });

  it("parses .ips JSON files", async () => {
    mockReaddir.mockResolvedValue(["MyApp.ips"]);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() });
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: "MyApp",
      timestamp: new Date().toISOString(),
      exception: { type: "EXC_CRASH", signal: "Abort trap: 6" },
      threads: [{
        triggered: true,
        frames: [
          { symbol: "abort_with_payload + 8", imageOffset: "0" },
          { symbol: "swift_fatalError + 10", imageOffset: "1" },
        ],
      }],
    }));

    const result = await getCrashLogs();
    expect(result[0]!.exceptionType).toBe("EXC_CRASH");
    expect(result[0]!.topFrames).toContain("0 abort_with_payload + 8");
  });

  it("filters by bundle_id substring", async () => {
    mockReaddir.mockResolvedValue(["MyApp.crash", "OtherApp.crash"]);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() });
    mockReadFile.mockImplementation(async (p: unknown) => {
      const filePath = p as string;
      if (filePath.includes("MyApp")) {
        return "Process:               MyApp [1]\nException Type: EXC_CRASH\n\nThread 0 Crashed:";
      }
      return "Process:               OtherApp [2]\nException Type: EXC_CRASH\n\nThread 0 Crashed:";
    });

    const result = await getCrashLogs("MyApp");
    expect(result).toHaveLength(1);
    expect(result[0]!.processName).toBe("MyApp");
  });

  it("skips files that cannot be read", async () => {
    mockReaddir.mockResolvedValue(["corrupt.crash"]);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() });
    mockReadFile.mockRejectedValue(new Error("EACCES"));

    const result = await getCrashLogs();
    expect(result).toHaveLength(0);
  });
});

// ── getNetworkCalls ────────────────────────────────────────────────────────────

describe("getNetworkCalls", () => {
  it("returns serverRunning=false when mock server is not running", async () => {
    const result = await getNetworkCalls();
    expect(result.serverRunning).toBe(false);
    expect(result.calls).toHaveLength(0);
  });
});
