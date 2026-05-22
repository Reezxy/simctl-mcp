import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec, isExecError } from "../utils/exec.js";
import { toolError, toolOk } from "../types.js";
import type { McpToolDef } from "../types.js";
import { mockServerState } from "../../mock-server/state.js";

// ── Crash log parsing (shared with assertions.ts) ─────────────────────────────

const DIAG_DIR = path.join(
  os.homedir(),
  "Library",
  "Logs",
  "DiagnosticReports"
);

interface CrashSummary {
  file: string;
  timestamp: number;
  exceptionType: string;
  exceptionSubtype: string;
  processName: string;
  topFrames: string[];
}

function parseCrashFile(content: string, filePath: string): CrashSummary {
  const base = path.basename(filePath);

  if (filePath.endsWith(".ips")) {
    try {
      const json = JSON.parse(content) as Record<string, unknown>;
      const exc = (json["exception"] as Record<string, string>) ?? {};
      const threads =
        (json["threads"] as Array<Record<string, unknown>>) ?? [];
      const crashed = threads.find((t) => (t["triggered"] as boolean) === true);
      const frames =
        (crashed?.["frames"] as Array<Record<string, string>>) ?? [];
      const topFrames = frames
        .slice(0, 5)
        .map(
          (f) => `${f["imageOffset"] ?? ""} ${f["symbol"] ?? f["imageIndex"] ?? ""}`.trim()
        );

      return {
        file: base,
        timestamp: new Date(
          (json["timestamp"] as string) ?? Date.now()
        ).getTime(),
        exceptionType: exc["type"] ?? "unknown",
        exceptionSubtype: exc["signal"] ?? exc["subtype"] ?? "",
        processName: (json["name"] as string) ?? base,
        topFrames,
      };
    } catch {
      // fall through to text parsing
    }
  }

  // Text .crash format
  const lines = content.split("\n");
  const get = (prefix: string) =>
    lines.find((l) => l.startsWith(prefix))?.replace(prefix, "").trim() ?? "";

  const crashedIdx = lines.findIndex(
    (l) => l.includes("Crashed:") || l.includes("Thread 0 Crashed")
  );
  const topFrames =
    crashedIdx >= 0
      ? lines
          .slice(crashedIdx + 1, crashedIdx + 6)
          .filter((l) => /^\d+\s/.test(l))
          .map((l) => l.trim())
      : [];

  return {
    file: base,
    timestamp: Date.now(),
    exceptionType: get("Exception Type:"),
    exceptionSubtype: get("Exception Subtype:"),
    processName: get("Process:").split(" ")[0] ?? base,
    topFrames,
  };
}

// ── Core logic ────────────────────────────────────────────────────────────────

export async function getConsoleLogs(
  lines = 100,
  filter?: string
): Promise<string[]> {
  const result = await exec(
    "xcrun simctl spawn booted log show --last 30s --style compact",
    { timeoutMs: 15_000 }
  );

  if (isExecError(result)) {
    throw new Error(`Could not read console logs: ${result.message}`);
  }

  let allLines = result.stdout.split("\n").filter(Boolean);

  if (filter) {
    const lf = filter.toLowerCase();
    allLines = allLines.filter((l) => l.toLowerCase().includes(lf));
  }

  return allLines.slice(-lines);
}

export async function getCrashLogs(bundleId?: string): Promise<CrashSummary[]> {
  let files: string[];
  try {
    files = await fs.readdir(DIAG_DIR);
  } catch {
    return [];
  }

  const crashFiles = files.filter(
    (f) => f.endsWith(".crash") || f.endsWith(".ips")
  );

  const summaries: CrashSummary[] = [];

  for (const file of crashFiles) {
    const filePath = path.join(DIAG_DIR, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const summary = parseCrashFile(content, filePath);

      // Filter by bundle_id / process name if requested
      if (
        bundleId &&
        !summary.processName.toLowerCase().includes(bundleId.toLowerCase()) &&
        !file.toLowerCase().includes(bundleId.toLowerCase())
      ) {
        continue;
      }

      summaries.push(summary);
    } catch {
      // skip unreadable files
    }
  }

  // Most recent first
  summaries.sort((a, b) => b.timestamp - a.timestamp);
  return summaries.slice(0, 20);
}

export async function getNetworkCalls(sinceMs?: number): Promise<{
  calls: typeof mockServerState.requests;
  serverRunning: boolean;
}> {
  if (!mockServerState.running) {
    return { calls: [], serverRunning: false };
  }

  const calls = sinceMs
    ? mockServerState.requests.filter((r) => r.timestamp >= sinceMs)
    : mockServerState.requests;

  return { calls, serverRunning: true };
}

export async function startMockServer(
  port = 3210,
  routesConfig?: Record<string, unknown>
): Promise<{ port: number; message: string }> {
  if (mockServerState.running) {
    return {
      port: mockServerState.port!,
      message: `Mock server already running on port ${mockServerState.port}`,
    };
  }

  // Full implementation injected by mock-server/index.ts at step 11.
  // Check if the start function has been registered.
  const starter = (
    globalThis as unknown as Record<string, unknown>
  )["__mockServerStart__"] as
    | ((port: number, routes?: Record<string, unknown>) => Promise<void>)
    | undefined;

  if (!starter) {
    throw new Error(
      "Mock server module not loaded. " +
        "Ensure mock-server/index.ts is imported at startup."
    );
  }

  await starter(port, routesConfig);
  return { port, message: `Mock server started on port ${port}` };
}

export async function stopMockServer(): Promise<{
  totalCalls: number;
  calls: typeof mockServerState.requests;
}> {
  if (!mockServerState.running || !mockServerState.stop) {
    return { totalCalls: 0, calls: [] };
  }

  const calls = [...mockServerState.requests];
  await mockServerState.stop();
  return { totalCalls: calls.length, calls };
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const diagnosticTools: McpToolDef[] = [
  {
    name: "get_console_logs",
    description:
      "Returns the last N lines of the simulator's console output from the past 30 seconds. " +
      "Provide filter to grep for a specific string (case-insensitive). " +
      "Useful for seeing what the app printed right before a failure.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Max lines to return. Default: 100.",
        },
        filter: {
          type: "string",
          description: "Case-insensitive substring to filter log lines.",
        },
      },
    },
    handler: async (args) => {
      const lines = (args["lines"] as number | undefined) ?? 100;
      const filter = args["filter"] as string | undefined;
      try {
        const result = await getConsoleLogs(lines, filter);
        return toolOk({ lines: result, count: result.length });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "get_crash_logs",
    description:
      "Returns crash reports from ~/Library/Logs/DiagnosticReports. " +
      "Summarises each crash: process name, exception type, and top 5 backtrace frames. " +
      "Optionally filter by bundle_id to only show crashes for your app. " +
      "Returns up to 20 most recent crashes.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: {
          type: "string",
          description: "Filter by app bundle identifier or process name.",
        },
      },
    },
    handler: async (args) => {
      const bundleId = args["bundle_id"] as string | undefined;
      try {
        const crashes = await getCrashLogs(bundleId);
        return toolOk({ count: crashes.length, crashes });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "get_network_calls",
    description:
      "Returns all HTTP requests the app made to the mock server. " +
      "Requires start_mock_server to be called first and the app pointed to the mock server URL. " +
      "Provide since_ms (Unix timestamp in ms) to filter to calls after a specific time. " +
      "Each call includes method, URL, request body, and response status.",
    inputSchema: {
      type: "object",
      properties: {
        since_ms: {
          type: "number",
          description:
            "Only return calls after this Unix timestamp (ms). Omit for all calls.",
        },
      },
    },
    handler: async (args) => {
      const sinceMs = args["since_ms"] as number | undefined;
      try {
        const result = await getNetworkCalls(sinceMs);
        if (!result.serverRunning) {
          return toolError(
            "Mock server is not running. Call start_mock_server first."
          );
        }
        return toolOk({ count: result.calls.length, calls: result.calls });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "start_mock_server",
    description:
      "Starts the bundled HTTP mock server on the given port (default 3210). " +
      "Pass routes_config to define which endpoints return what responses. " +
      "Example route: { \"GET /api/user\": { \"status\": 200, \"body\": { \"id\": 1 } } }. " +
      "The app must use http://localhost:{port} as its API base URL.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port to listen on. Default: 3210.",
        },
        routes_config: {
          type: "object",
          description: "Route definitions keyed by 'METHOD /path'.",
        },
      },
    },
    handler: async (args) => {
      const port = (args["port"] as number | undefined) ?? 3210;
      const routes = args["routes_config"] as
        | Record<string, unknown>
        | undefined;
      try {
        const result = await startMockServer(port, routes);
        return toolOk(result);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "stop_mock_server",
    description:
      "Stops the mock server and returns a summary of all HTTP calls that were recorded. " +
      "Call this at the end of a test session to get the full network traffic log.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const result = await stopMockServer();
        return toolOk(result);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },
];
