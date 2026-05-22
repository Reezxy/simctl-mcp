import { jest } from "@jest/globals";
import type { ExecResponse } from "../utils/exec.js";

const mockExec = jest.fn<() => Promise<ExecResponse>>();

jest.unstable_mockModule("../utils/exec.js", () => ({
  exec: mockExec,
  isExecError: (r: unknown) =>
    typeof r === "object" && r !== null && "error" in r,
}));

// Dynamic imports must come AFTER unstable_mockModule
const { getBackend, isIdbAvailable, getIdbPath, idbCmd, resetBackendCache } =
  await import("../utils/idb-check.js");

const idbFound = (): ExecResponse => ({
  stdout: "/usr/local/bin/idb",
  stderr: "",
});
const notFound = (): ExecResponse => ({
  error: true as const,
  message: "not found",
  command: "",
});
const xcrunOk = (): ExecResponse => ({
  stdout: "Usage: simctl",
  stderr: "",
});

beforeEach(() => {
  resetBackendCache();
  mockExec.mockReset();
});

describe("getBackend — idb available", () => {
  it("returns idb backend when idb is on PATH", async () => {
    mockExec.mockResolvedValue(idbFound());
    const status = await getBackend();
    expect(status.backend).toBe("idb");
    expect(status.idbPath).toBe("/usr/local/bin/idb");
  });
});

describe("getBackend — idb missing, xcrun available", () => {
  it("falls back to xcrun and sets warned=true", async () => {
    // which idb → not found; 3 candidate checks → not found; xcrun → ok
    mockExec
      .mockResolvedValueOnce(notFound()) // which idb
      .mockResolvedValueOnce(notFound()) // candidate 1
      .mockResolvedValueOnce(notFound()) // candidate 2
      .mockResolvedValueOnce(notFound()) // candidate 3
      .mockResolvedValueOnce(xcrunOk()); // xcrun simctl help

    const status = await getBackend();
    expect(status.backend).toBe("xcrun");
    expect(status.warned).toBe(true);
  });
});

describe("getBackend — nothing available", () => {
  it("throws a helpful error when neither backend is found", async () => {
    mockExec.mockResolvedValue(notFound());
    await expect(getBackend()).rejects.toThrow(/idb nor xcrun/);
  });
});

describe("isIdbAvailable", () => {
  it("returns true when idb is found", async () => {
    mockExec.mockResolvedValue(idbFound());
    expect(await isIdbAvailable()).toBe(true);
  });

  it("returns false when xcrun is active", async () => {
    mockExec
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(xcrunOk());
    expect(await isIdbAvailable()).toBe(false);
  });
});

describe("getIdbPath", () => {
  it("returns the binary path when idb is found", async () => {
    mockExec.mockResolvedValue(idbFound());
    expect(await getIdbPath()).toBe("/usr/local/bin/idb");
  });

  it("returns null when xcrun backend is active", async () => {
    mockExec
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(xcrunOk());
    expect(await getIdbPath()).toBeNull();
  });
});

describe("idbCmd", () => {
  it("prepends the resolved idb path", async () => {
    mockExec.mockResolvedValue({
      stdout: "/opt/homebrew/bin/idb",
      stderr: "",
    });
    const cmd = await idbCmd("ui describe-all");
    expect(cmd).toBe("/opt/homebrew/bin/idb ui describe-all");
  });
});

describe("caching", () => {
  it("calls exec only once across multiple getBackend calls", async () => {
    mockExec.mockResolvedValue(idbFound());
    await getBackend();
    await getBackend();
    await getBackend();
    // `which idb` is called exactly once before caching kicks in
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
