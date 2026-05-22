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
export declare function isExecError(result: ExecResponse): result is ExecError;
interface ExecOptions {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    maxBuffer?: number;
}
export declare function exec(command: string, options?: ExecOptions): Promise<ExecResponse>;
export declare function execOrThrow(command: string, options?: ExecOptions): Promise<ExecResult>;
export {};
//# sourceMappingURL=exec.d.ts.map