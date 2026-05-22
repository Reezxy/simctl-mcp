import { exec as nodeExec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(nodeExec);
export function isExecError(result) {
    return "error" in result && result.error === true;
}
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function exec(command, options = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, retryDelayMs = 500, maxBuffer = DEFAULT_MAX_BUFFER, } = options;
    let lastError = null;
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
        }
        catch (err) {
            const e = err;
            lastError = {
                error: true,
                message: e.message ?? String(err),
                command,
                stderr: typeof e.stderr === "string" ? e.stderr.trim() : undefined,
                code: typeof e.code === "number" ? e.code : undefined,
            };
        }
    }
    return lastError;
}
export async function execOrThrow(command, options = {}) {
    const result = await exec(command, options);
    if (isExecError(result)) {
        throw new Error(`Command failed: ${result.command}\n${result.message}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`);
    }
    return result;
}
//# sourceMappingURL=exec.js.map