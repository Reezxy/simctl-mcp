import * as fs from "fs/promises";
import { getAccessibilityTree } from "./accessibility.js";
import { captureRawPng } from "./screenshot.js";
import { diffScreenshots } from "../engine/screenshot-processor.js";
import { findElement } from "../engine/element-finder.js";
import { toolError, toolOk } from "../types.js";
// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_ELEMENT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_STABLE_TIMEOUT_MS = 3_000;
const STABLE_CAPTURE_GAP_MS = 300;
const STABLE_DIFF_THRESHOLD = 2; // % pixel change considered "stable"
// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function tryUnlink(p) {
    try {
        await fs.unlink(p);
    }
    catch {
        // best-effort
    }
}
// ── Core logic (exported for tests) ──────────────────────────────────────────
/**
 * Polls the accessibility tree at `pollIntervalMs` until `label` appears or
 * `timeoutMs` is exceeded.  Returns immediately on first match.
 */
export async function waitForElement(label, timeoutMs = DEFAULT_ELEMENT_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
    const start = Date.now();
    while (true) {
        const { elements } = await getAccessibilityTree();
        const match = findElement(elements, label, "fuzzy");
        if (match.found) {
            return { found: true, elapsed_ms: Date.now() - start };
        }
        const elapsed = Date.now() - start;
        if (elapsed >= timeoutMs) {
            return { found: false, elapsed_ms: elapsed, timed_out: true };
        }
        await sleep(pollIntervalMs);
    }
}
/**
 * Captures two screenshots `STABLE_CAPTURE_GAP_MS` apart and diffs them.
 * Returns `stable: true` as soon as pixel diff is below `STABLE_DIFF_THRESHOLD`.
 * Retries until `timeoutMs`.  Always cleans up temporary PNG files.
 *
 * Call this after every navigation action before reading the accessibility tree
 * to avoid reading stale state mid-animation.
 */
export async function waitForScreenStable(timeoutMs = DEFAULT_STABLE_TIMEOUT_MS) {
    const start = Date.now();
    while (true) {
        const png1 = await captureRawPng();
        await sleep(STABLE_CAPTURE_GAP_MS);
        const png2 = await captureRawPng();
        let diffResult;
        try {
            diffResult = await diffScreenshots(png1, png2, STABLE_DIFF_THRESHOLD);
        }
        finally {
            await tryUnlink(png1);
            await tryUnlink(png2);
        }
        // Clean up the diff image — we only need the percentage
        await tryUnlink(diffResult.diffImagePath);
        const elapsed = Date.now() - start;
        if (diffResult.matches) {
            return {
                stable: true,
                elapsed_ms: elapsed,
                final_diff_percent: diffResult.diffPercent,
            };
        }
        if (elapsed >= timeoutMs) {
            return {
                stable: false,
                elapsed_ms: elapsed,
                final_diff_percent: diffResult.diffPercent,
            };
        }
        // No extra sleep: the 300ms gap between captures already acts as a wait
    }
}
/**
 * Polls until `label` disappears from the accessibility tree or `timeoutMs`
 * is exceeded.  Useful after dismissing modals, loading spinners, or toasts.
 *
 * Return value semantics:
 *   found: false → element is gone (success)
 *   found: true  → element still present when timeout hit
 */
export async function waitForElementGone(label, timeoutMs = DEFAULT_ELEMENT_TIMEOUT_MS) {
    const start = Date.now();
    const pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    while (true) {
        const { elements } = await getAccessibilityTree();
        const match = findElement(elements, label, "fuzzy");
        if (!match.found) {
            return { found: false, elapsed_ms: Date.now() - start };
        }
        const elapsed = Date.now() - start;
        if (elapsed >= timeoutMs) {
            return { found: true, elapsed_ms: elapsed, timed_out: true };
        }
        await sleep(pollIntervalMs);
    }
}
// ── MCP tool definitions ──────────────────────────────────────────────────────
export const waitTools = [
    {
        name: "wait_for_element",
        description: "Polls the accessibility tree until an element with the given label appears or the timeout is exceeded. " +
            "Returns { found, elapsed_ms, timed_out }. " +
            "Use after tapping buttons that trigger async navigation or loading — " +
            "pair with wait_for_screen_stable to confirm the transition is complete. " +
            "Default timeout: 5000ms, poll interval: 500ms.",
        inputSchema: {
            type: "object",
            properties: {
                label: {
                    type: "string",
                    description: "Label of the element to wait for (fuzzy matched).",
                },
                timeout_ms: {
                    type: "number",
                    description: "Maximum wait time in milliseconds. Default: 5000.",
                },
                poll_interval_ms: {
                    type: "number",
                    description: "How often to check the tree in milliseconds. Default: 500.",
                },
            },
            required: ["label"],
        },
        handler: async (args) => {
            const label = args["label"];
            const timeout = args["timeout_ms"] ?? DEFAULT_ELEMENT_TIMEOUT_MS;
            const poll = args["poll_interval_ms"] ?? DEFAULT_POLL_INTERVAL_MS;
            try {
                const result = await waitForElement(label, timeout, poll);
                return toolOk(result);
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "wait_for_screen_stable",
        description: "Waits until the screen stops changing. " +
            "Takes two screenshots 300ms apart; if pixel diff is below 2%, the screen is considered stable " +
            "(animations done, loading complete). Retries until timeout_ms. " +
            "ALWAYS call this after any tap, swipe, or navigation before reading the accessibility tree. " +
            "Returns { stable, elapsed_ms, final_diff_percent }. Default timeout: 3000ms.",
        inputSchema: {
            type: "object",
            properties: {
                timeout_ms: {
                    type: "number",
                    description: "Maximum wait time in milliseconds. Default: 3000.",
                },
            },
        },
        handler: async (args) => {
            const timeout = args["timeout_ms"] ?? DEFAULT_STABLE_TIMEOUT_MS;
            try {
                const result = await waitForScreenStable(timeout);
                return toolOk(result);
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "wait_for_element_gone",
        description: "Waits until an element disappears from the accessibility tree. " +
            "Use after dismissing modals, loading spinners, toasts, or overlays. " +
            "Returns { found: false } when gone, { found: true, timed_out: true } if still present at timeout. " +
            "Default timeout: 5000ms.",
        inputSchema: {
            type: "object",
            properties: {
                label: {
                    type: "string",
                    description: "Label of the element to wait to disappear (fuzzy matched).",
                },
                timeout_ms: {
                    type: "number",
                    description: "Maximum wait time in milliseconds. Default: 5000.",
                },
            },
            required: ["label"],
        },
        handler: async (args) => {
            const label = args["label"];
            const timeout = args["timeout_ms"] ?? DEFAULT_ELEMENT_TIMEOUT_MS;
            try {
                const result = await waitForElementGone(label, timeout);
                return toolOk(result);
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
];
//# sourceMappingURL=wait.js.map