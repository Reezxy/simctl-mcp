import { exec as nodeExec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(nodeExec);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecError {
  error: true;
  message: string;
  command: string;
  stderr?: string;
  code?: number;
}

export type ExecResponse = ExecResult | ExecError;

export function isExecError(result: ExecResponse): result is ExecError {
  return "error" in result && result.error === true;
}

interface ExecOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exec(
  command: string,
  options: ExecOptions = {}
): Promise<ExecResponse> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    retryDelayMs = 500,
    maxBuffer = DEFAULT_MAX_BUFFER,
  } = options;

  let lastError: ExecError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelayMs);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeoutMs,
        maxBuffer,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      lastError = {
        error: true,
        message: e.message ?? String(err),
        command,
        stderr: typeof e.stderr === "string" ? e.stderr.trim() : undefined,
        code: typeof e.code === "number" ? e.code : undefined,
      };
    }
  }

  return lastError!;
}

export async function execOrThrow(
  command: string,
  options: ExecOptions = {}
): Promise<ExecResult> {
  const result = await exec(command, options);
  if (isExecError(result)) {
    throw new Error(
      `Command failed: ${result.command}\n${result.message}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`
    );
  }
  return result;
}
