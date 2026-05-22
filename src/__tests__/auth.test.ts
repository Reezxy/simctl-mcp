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

jest.unstable_mockModule("../utils/idb-check.js", () => ({
  getBackend: jest.fn<() => Promise<{ backend: string; idbPath: string }>>().mockResolvedValue({
    backend: "idb",
    idbPath: "/usr/local/bin/idb",
  }),
  idbCmd: jest.fn(),
  isIdbAvailable: jest.fn(),
  getIdbPath: jest.fn(),
  resetBackendCache: jest.fn(),
}));

const {
  injectUserDefaults,
  readUserDefaults,
  setKeychainValue,
  resetAppState,
  setLocation,
  setPermissions,
} = await import("../tools/auth.js");

const ok = (stdout = ""): ExecResponse => ({ stdout, stderr: "" });
const err = (msg = "failed"): ExecResponse => ({
  error: true as const,
  message: msg,
  command: "",
});

beforeEach(() => {
  mockExec.mockReset();
  mockExecOrThrow.mockReset();
});

// ── injectUserDefaults ─────────────────────────────────────────────────────────

describe("injectUserDefaults", () => {
  it("writes a string value with -string flag", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await injectUserDefaults("com.app", "username", "testuser");
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining('-string "testuser"'),
      expect.anything()
    );
  });

  it("writes a boolean true as YES", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await injectUserDefaults("com.app", "onboardingDone", true);
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("-bool \"YES\""),
      expect.anything()
    );
  });

  it("writes a boolean false as NO", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await injectUserDefaults("com.app", "flag", false);
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("-bool \"NO\""),
      expect.anything()
    );
  });

  it("writes an integer with -integer flag", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await injectUserDefaults("com.app", "count", 42);
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("-integer \"42\""),
      expect.anything()
    );
  });

  it("writes a float with -float flag", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await injectUserDefaults("com.app", "ratio", 0.5);
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("-float \"0.5\""),
      expect.anything()
    );
  });
});

// ── readUserDefaults ───────────────────────────────────────────────────────────

describe("readUserDefaults", () => {
  it("returns the value when key exists", async () => {
    mockExec.mockResolvedValue(ok("1"));
    const value = await readUserDefaults("com.app", "onboardingDone");
    expect(value).toBe("1");
  });

  it("returns null when exec fails (key not found)", async () => {
    mockExec.mockResolvedValue(err("key not found"));
    const value = await readUserDefaults("com.app", "missing");
    expect(value).toBeNull();
  });

  it("returns null for empty output", async () => {
    mockExec.mockResolvedValue(ok("   "));
    const value = await readUserDefaults("com.app", "empty");
    expect(value).toBeNull();
  });
});

// ── setKeychainValue ───────────────────────────────────────────────────────────

describe("setKeychainValue", () => {
  it("calls idb keychain add with correct args", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await setKeychainValue("user@example.com", "com.app.auth", "token123");
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("keychain add"),
      expect.anything()
    );
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("--account"),
      expect.anything()
    );
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("token123"),
      expect.anything()
    );
  });
});

// ── resetAppState ──────────────────────────────────────────────────────────────

describe("resetAppState", () => {
  it("returns a step log with all phases", async () => {
    // terminate → ok
    mockExec.mockResolvedValueOnce(ok());
    // get_app_container → container path
    mockExec.mockResolvedValueOnce(ok("/tmp/container"));
    // rm Library, Documents, tmp
    mockExec.mockResolvedValue(ok());

    const steps = await resetAppState("com.example.app");
    expect(steps).toContain("terminate: ok");
    expect(steps.some((s) => s.includes("clear Library"))).toBe(true);
    expect(steps.some((s) => s.includes("reset permissions"))).toBe(true);
  });

  it("includes skipped message when get_app_container fails", async () => {
    mockExec.mockResolvedValueOnce(ok()); // terminate
    mockExec.mockResolvedValueOnce(err("app not installed")); // get_app_container
    mockExec.mockResolvedValue(ok()); // rest

    const steps = await resetAppState("com.missing.app");
    expect(steps.some((s) => s.includes("get_app_container: skipped"))).toBe(true);
  });
});

// ── setLocation ────────────────────────────────────────────────────────────────

describe("setLocation", () => {
  it("calls xcrun simctl location booted set", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await setLocation(37.7749, -122.4194);
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("location booted set 37.7749 -122.4194"),
      expect.anything()
    );
  });
});

// ── setPermissions ─────────────────────────────────────────────────────────────

describe("setPermissions", () => {
  it("grants camera permission", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await setPermissions("com.app", "camera", "grant");
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("privacy booted grant camera"),
      expect.anything()
    );
  });

  it("revokes location permission", async () => {
    mockExecOrThrow.mockResolvedValue(ok());
    await setPermissions("com.app", "location", "revoke");
    expect(mockExecOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("privacy booted revoke location"),
      expect.anything()
    );
  });
});
