export type SimulatorBackend = "idb" | "xcrun";
interface BackendStatus {
    backend: SimulatorBackend;
    idbPath?: string;
    warned: boolean;
}
/**
 * Returns the preferred backend (idb or xcrun). Result is cached for the
 * process lifetime. Logs a one-time warning if idb is unavailable.
 */
export declare function getBackend(): Promise<BackendStatus>;
/** Returns true when idb is the active backend. */
export declare function isIdbAvailable(): Promise<boolean>;
/** Returns the idb binary path, or null if xcrun is the active backend. */
export declare function getIdbPath(): Promise<string | null>;
/**
 * Builds a full idb command string using the resolved binary path.
 * Falls back to the bare `idb` name if path resolution somehow failed.
 */
export declare function idbCmd(args: string): Promise<string>;
/** Clears the cached backend detection result (useful in tests). */
export declare function resetBackendCache(): void;
export {};
//# sourceMappingURL=idb-check.d.ts.map