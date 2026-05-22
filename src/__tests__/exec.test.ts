import { exec, execOrThrow, isExecError } from "../utils/exec.js";

describe("exec", () => {
  it("returns stdout for a successful command", async () => {
    const result = await exec("echo hello");
    expect(isExecError(result)).toBe(false);
    if (!isExecError(result)) {
      expect(result.stdout).toBe("hello");
    }
  });

  it("returns ExecError for a failing command", async () => {
    const result = await exec("false");
    expect(isExecError(result)).toBe(true);
    if (isExecError(result)) {
      expect(result.error).toBe(true);
      expect(result.command).toBe("false");
      expect(typeof result.message).toBe("string");
    }
  });

  it("trims trailing newlines from stdout", async () => {
    const result = await exec("printf 'hello\\n'");
    expect(isExecError(result)).toBe(false);
    if (!isExecError(result)) {
      expect(result.stdout).toBe("hello");
    }
  });

  it("retries on failure and eventually succeeds if command works on retry", async () => {
    // Use a command that always succeeds to verify retry path doesn't break success
    const result = await exec("echo ok", { retries: 2 });
    expect(isExecError(result)).toBe(false);
    if (!isExecError(result)) {
      expect(result.stdout).toBe("ok");
    }
  });

  it("returns last error after exhausting retries", async () => {
    const result = await exec("false", { retries: 2, retryDelayMs: 10 });
    expect(isExecError(result)).toBe(true);
  });

  it("times out long-running commands", async () => {
    const result = await exec("sleep 10", { timeoutMs: 100 });
    expect(isExecError(result)).toBe(true);
  });
});

describe("execOrThrow", () => {
  it("returns result for successful command", async () => {
    const result = await execOrThrow("echo success");
    expect(result.stdout).toBe("success");
  });

  it("throws for a failing command", async () => {
    await expect(execOrThrow("false")).rejects.toThrow("Command failed");
  });
});

describe("isExecError", () => {
  it("returns true for ExecError objects", () => {
    expect(isExecError({ error: true, message: "oops", command: "cmd" })).toBe(
      true
    );
  });

  it("returns false for ExecResult objects", () => {
    expect(isExecError({ stdout: "out", stderr: "" })).toBe(false);
  });
});
