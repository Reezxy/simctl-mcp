import { jest } from "@jest/globals";
import type { ExecResponse } from "../utils/exec.js";

const mockExec = jest.fn<() => Promise<ExecResponse>>();
const mockExecOrThrow = jest.fn<() => Promise<{ stdout: string; stderr: string }>>();

jest.unstable_mockModule("../utils/exec.js", () => ({
  exec: mockExec,
  execOrThrow: mockExecOrThrow,
  isExecError: (r: unknown) =>
    typeof r === "object" && r !== null && "error" in r,
}));

const { listSimulators, getBootedSimulator, installApp, launchApp, terminateApp } =
  await import("../tools/simulator.js");

const ok = (stdout: string): { stdout: string; stderr: string } => ({
  stdout,
  stderr: "",
});
const err = (msg = "failed"): ExecResponse => ({
  error: true as const,
  message: msg,
  command: "",
});

const SIMCTL_DEVICES_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
      {
        udid: "AAA-BBB",
        name: "iPhone 15 Pro",
        state: "Booted",
        isAvailable: true,
      },
      {
        udid: "CCC-DDD",
        name: "iPhone SE",
        state: "Shutdown",
        isAvailable: true,
      },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-16-4": [
      {
        udid: "EEE-FFF",
        name: "iPhone 14",
        state: "Shutdown",
        isAvailable: false,
      },
    ],
  },
});

beforeEach(() => {
  mockExec.mockReset();
  mockExecOrThrow.mockReset();
});

// ── listSimulators ─────────────────────────────────────────────────────────────

describe("listSimulators", () => {
  it("returns a flat list of simulators with parsed OS", async () => {
    mockExecOrThrow.mockResolvedValueOnce(ok(SIMCTL_DEVICES_JSON));

    const sims = await listSimulators();
    expect(sims).toHaveLength(3);

    expect(sims[0]).toMatchObject({
      udid: "AAA-BBB",
      name: "iPhone 15 Pro",
      os: "iOS 17.2",
      state: "Booted",
      isAvailable: true,
    });

    expect(sims[1]).toMatchObject({
      udid: "CCC-DDD",
      name: "iPhone SE",
      os: "iOS 17.2",
      state: "Shutdown",
    });

    expect(sims[2]).toMatchObject({
      udid: "EEE-FFF",
      os: "iOS 16.4",
      isAvailable: false,
    });
  });

  it("propagates exec errors as thrown exceptions", async () => {
    mockExecOrThrow.mockRejectedValueOnce(new Error("simctl not found"));
    await expect(listSimulators()).rejects.toThrow("simctl not found");
  });
});

// ── getBootedSimulator ─────────────────────────────────────────────────────────

describe("getBootedSimulator", () => {
  it("returns the first booted simulator", async () => {
    mockExec.mockResolvedValueOnce(ok(SIMCTL_DEVICES_JSON));

    const sim = await getBootedSimulator();
    expect(sim).not.toBeNull();
    expect(sim!.udid).toBe("AAA-BBB");
    expect(sim!.state).toBe("Booted");
    expect(sim!.os).toBe("iOS 17.2");
  });

  it("returns null when no simulator is booted", async () => {
    const noBooted = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "CCC", name: "iPhone SE", state: "Shutdown", isAvailable: true },
        ],
      },
    });
    mockExec.mockResolvedValueOnce(ok(noBooted));

    const sim = await getBootedSimulator();
    expect(sim).toBeNull();
  });

  it("returns null on exec error", async () => {
    mockExec.mockResolvedValueOnce(err("permission denied"));
    const sim = await getBootedSimulator();
    expect(sim).toBeNull();
  });

  it("returns null when JSON is malformed", async () => {
    mockExec.mockResolvedValueOnce(ok("not json {{{"));
    const sim = await getBootedSimulator();
    expect(sim).toBeNull();
  });
});

// ── installApp ─────────────────────────────────────────────────────────────────

describe("installApp", () => {
  it("calls xcrun simctl install booted with the provided path", async () => {
    mockExecOrThrow.mockResolvedValueOnce(ok(""));
    await expect(installApp("/path/to/MyApp.app")).resolves.toBeUndefined();
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      'xcrun simctl install booted "/path/to/MyApp.app"',
      expect.objectContaining({ timeoutMs: 60_000 })
    );
  });

  it("throws when install fails", async () => {
    mockExecOrThrow.mockRejectedValueOnce(new Error("No booted device"));
    await expect(installApp("/bad.app")).rejects.toThrow("No booted device");
  });
});

// ── launchApp ──────────────────────────────────────────────────────────────────

describe("launchApp", () => {
  it("launches without reset by default", async () => {
    mockExecOrThrow.mockResolvedValueOnce(
      ok("com.example.app: 1234")
    );
    const output = await launchApp("com.example.app");
    expect(output).toBe("com.example.app: 1234");
    expect(mockExecOrThrow).toHaveBeenCalledTimes(1);
  });

  it("resets state then launches when reset_state=true", async () => {
    const bootedJson = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "AAA-BBB", name: "iPhone 15 Pro", state: "Booted", isAvailable: true },
        ],
      },
    });

    // 1. xcrun simctl privacy booted reset all
    mockExec.mockResolvedValueOnce(ok(""));
    // 2. xcrun simctl list devices booted --json (inside getBootedUdid)
    mockExec.mockResolvedValueOnce(ok(bootedJson));
    // 3. xcrun simctl get_app_container booted … data
    mockExec.mockResolvedValueOnce(ok("/path/to/container"));
    // 4. rm -f plist
    mockExec.mockResolvedValueOnce(ok(""));
    // 5. xcrun simctl launch booted
    mockExecOrThrow.mockResolvedValueOnce(ok("com.example.app: 5678"));

    const output = await launchApp("com.example.app", true);
    expect(output).toBe("com.example.app: 5678");

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("privacy booted reset all"),
      expect.anything()
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("get_app_container"),
      expect.anything()
    );
  });

  it("throws when launch fails", async () => {
    mockExecOrThrow.mockRejectedValueOnce(new Error("app not installed"));
    await expect(launchApp("com.example.app")).rejects.toThrow(
      "app not installed"
    );
  });
});

// ── terminateApp ───────────────────────────────────────────────────────────────

describe("terminateApp", () => {
  it("calls xcrun simctl terminate booted", async () => {
    mockExecOrThrow.mockResolvedValueOnce(ok(""));
    await expect(terminateApp("com.example.app")).resolves.toBeUndefined();
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      'xcrun simctl terminate booted "com.example.app"',
      expect.anything()
    );
  });
});
