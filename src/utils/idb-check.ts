import { exec, isExecError } from "./exec.js";

export type SimulatorBackend = "idb" | "xcrun";

interface BackendStatus {
  backend: SimulatorBackend;
  idbPath?: string;
  warned: boolean;
}

let cachedStatus: BackendStatus | null = null;

async function detectIdb(): Promise<string | null> {
  const result = await exec("which idb", { timeoutMs: 5_000 });
  if (!isExecError(result) && result.stdout.length > 0) {
    return result.stdout.trim();
  }

  // Also check common Homebrew / pyenv / pip install locations
  const candidates = [
    "/usr/local/bin/idb",
    "/opt/homebrew/bin/idb",
    `${process.env.HOME}/.local/bin/idb`,
  ];
  for (const candidate of candidates) {
    const check = await exec(`test -x "${candidate}" && echo ok`, {
      timeoutMs: 3_000,
    });
    if (!isExecError(check) && check.stdout === "ok") {
      return candidate;
    }
  }

  return null;
}

async function detectXcrun(): Promise<boolean> {
  const result = await exec("xcrun simctl help", { timeoutMs: 5_000 });
  return !isExecError(result);
}

/**
 * Returns the preferred backend (idb or xcrun). Result is cached for the
 * process lifetime. Logs a one-time warning if idb is unavailable.
 */
export async function getBackend(): Promise<BackendStatus> {
  if (cachedStatus !== null) {
    return cachedStatus;
  }

  const idbPath = await detectIdb();

  if (idbPath !== null) {
    cachedStatus = { backend: "idb", idbPath, warned: false };
    return cachedStatus;
  }

  const xcrunAvailable = await detectXcrun();
  if (!xcrunAvailable) {
    throw new Error(
      "Neither idb nor xcrun simctl is available. " +
        "Install Xcode Command Line Tools (`xcode-select --install`) " +
        "or idb (`pip3 install fb-idb`) to continue."
    );
  }

  // Warn once to stderr so the MCP server can surface it
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[ios-simulator-mcp] idb not found — falling back to xcrun simctl. " +
        "Some accessibility features may be limited. " +
        "Install idb for full functionality: pip3 install fb-idb"
    );
  }

  cachedStatus = { backend: "xcrun", warned: true };
  return cachedStatus;
}

/** Returns true when idb is the active backend. */
export async function isIdbAvailable(): Promise<boolean> {
  const status = await getBackend();
  return status.backend === "idb";
}

/** Returns the idb binary path, or null if xcrun is the active backend. */
export async function getIdbPath(): Promise<string | null> {
  const status = await getBackend();
  return status.idbPath ?? null;
}

/**
 * Builds a full idb command string using the resolved binary path.
 * Falls back to the bare `idb` name if path resolution somehow failed.
 */
export async function idbCmd(args: string): Promise<string> {
  const path = (await getIdbPath()) ?? "idb";
  return `${path} ${args}`;
}

/** Clears the cached backend detection result (useful in tests). */
export function resetBackendCache(): void {
  cachedStatus = null;
}
