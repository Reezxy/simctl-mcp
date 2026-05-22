import type { McpToolDef, StabilityResult, WaitResult } from "../types.js";
/**
 * Polls the accessibility tree at `pollIntervalMs` until `label` appears or
 * `timeoutMs` is exceeded.  Returns immediately on first match.
 */
export declare function waitForElement(label: string, timeoutMs?: number, pollIntervalMs?: number): Promise<WaitResult>;
/**
 * Captures two screenshots `STABLE_CAPTURE_GAP_MS` apart and diffs them.
 * Returns `stable: true` as soon as pixel diff is below `STABLE_DIFF_THRESHOLD`.
 * Retries until `timeoutMs`.  Always cleans up temporary PNG files.
 *
 * Call this after every navigation action before reading the accessibility tree
 * to avoid reading stale state mid-animation.
 */
export declare function waitForScreenStable(timeoutMs?: number): Promise<StabilityResult>;
/**
 * Polls until `label` disappears from the accessibility tree or `timeoutMs`
 * is exceeded.  Useful after dismissing modals, loading spinners, or toasts.
 *
 * Return value semantics:
 *   found: false → element is gone (success)
 *   found: true  → element still present when timeout hit
 */
export declare function waitForElementGone(label: string, timeoutMs?: number): Promise<WaitResult>;
export declare const waitTools: McpToolDef[];
//# sourceMappingURL=wait.d.ts.map