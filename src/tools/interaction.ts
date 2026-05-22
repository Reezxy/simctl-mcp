import { exec, isExecError } from "../utils/exec.js";
import { getBackend, idbCmd } from "../utils/idb-check.js";
import { getAccessibilityTree } from "./accessibility.js";
import { takeScreenshot } from "./screenshot.js";
import { findElement } from "../engine/element-finder.js";
import { toolError, toolOk } from "../types.js";
import type { McpToolDef, McpToolResult, UIElement } from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SCREEN_WIDTH = 393;
const DEFAULT_SCREEN_HEIGHT = 852;

// HID key code for backspace/delete
const HID_DELETE = 42;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireIdb(): Promise<string> {
  const backend = await getBackend();
  if (backend.backend !== "idb") {
    throw new Error(
      "Interaction tools require idb. " +
        "Install idb (pip3 install fb-idb) to use tap/swipe/input. " +
        "Use take_screenshot as a fallback to see current state."
    );
  }
  return backend.idbPath!;
}

function centerOf(el: UIElement): { x: number; y: number } {
  return {
    x: Math.round(el.frame.x + el.frame.width / 2),
    y: Math.round(el.frame.y + el.frame.height / 2),
  };
}

async function getScreenDimensions(): Promise<{
  width: number;
  height: number;
}> {
  try {
    const { elements } = await getAccessibilityTree();
    // Root (depth 0) element is the Application — its frame = screen bounds
    const root = elements.find((e) => e.depth === 0);
    if (root && root.frame.width > 0 && root.frame.height > 0) {
      return { width: root.frame.width, height: root.frame.height };
    }
  } catch {
    // fall through to defaults
  }
  return { width: DEFAULT_SCREEN_WIDTH, height: DEFAULT_SCREEN_HEIGHT };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Core logic ────────────────────────────────────────────────────────────────

export async function tapByLabel(
  label: string,
  fallbackScreenshot = false
): Promise<McpToolResult> {
  const idbPath = await requireIdb();

  const { elements } = await getAccessibilityTree();
  const found = findElement(elements, label, "fuzzy");

  if (!found.found || !found.element) {
    if (fallbackScreenshot) {
      const screenshotResult = await takeScreenshot().catch(() => null);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: true,
              message: `Element not found: "${label}". ${found.suggestion ?? ""}`,
              fallback: "Screenshot captured so you can decide next step visually.",
            }),
          },
          ...(screenshotResult?.content ?? []),
        ],
        isError: true,
      };
    }
    return toolError(
      `Element not found: "${label}". ${found.suggestion ?? "Try take_screenshot to see current state."}`
    );
  }

  const { x, y } = centerOf(found.element);

  // Warn if center is outside visible screen
  const { width, height } = await getScreenDimensions();
  const cx = clamp(x, 0, width);
  const cy = clamp(y, 0, height);
  const clamped = cx !== x || cy !== y;

  const result = await exec(
    `${idbPath} ui tap ${cx} ${cy}`,
    { timeoutMs: 10_000 }
  );

  if (isExecError(result)) {
    throw new Error(`Tap failed: ${result.message}`);
  }

  return toolOk({
    success: true,
    label: found.element.label,
    confidence: found.confidence,
    x: cx,
    y: cy,
    clamped,
  });
}

export async function tapAt(x: number, y: number): Promise<void> {
  const idbPath = await requireIdb();
  const result = await exec(`${idbPath} ui tap ${x} ${y}`, {
    timeoutMs: 10_000,
  });
  if (isExecError(result)) {
    throw new Error(`Tap at (${x}, ${y}) failed: ${result.message}`);
  }
}

export async function inputText(
  text: string,
  clearFirst = false
): Promise<void> {
  const idbPath = await requireIdb();

  if (clearFirst) {
    // Send 100 backspace/delete key events to clear existing content
    const deletes = Array(100).fill(HID_DELETE).join(" ");
    await exec(`${idbPath} ui key-sequence ${deletes}`, { timeoutMs: 15_000 });
  }

  // Escape double-quotes in the text for shell safety
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const result = await exec(`${idbPath} ui type "${escaped}"`, {
    timeoutMs: 15_000,
  });
  if (isExecError(result)) {
    throw new Error(`Text input failed: ${result.message}`);
  }
}

export type SwipeDirection = "up" | "down" | "left" | "right";

export async function swipe(
  direction: SwipeDirection,
  distancePercent = 50,
  screenWidth = DEFAULT_SCREEN_WIDTH,
  screenHeight = DEFAULT_SCREEN_HEIGHT
): Promise<void> {
  const idbPath = await requireIdb();
  const { width, height } = { width: screenWidth, height: screenHeight };

  const dist = clamp(distancePercent, 0, 100) / 100;
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);

  let x1 = cx, y1 = cy, x2 = cx, y2 = cy;

  switch (direction) {
    case "up":
      y1 = Math.round(height * 0.7);
      y2 = Math.round(height * 0.7 - height * dist);
      break;
    case "down":
      y1 = Math.round(height * 0.3);
      y2 = Math.round(height * 0.3 + height * dist);
      break;
    case "left":
      x1 = Math.round(width * 0.8);
      x2 = Math.round(width * 0.8 - width * dist);
      break;
    case "right":
      x1 = Math.round(width * 0.2);
      x2 = Math.round(width * 0.2 + width * dist);
      break;
  }

  x2 = clamp(x2, 5, width - 5);
  y2 = clamp(y2, 5, height - 5);

  const result = await exec(
    `${idbPath} ui swipe ${x1} ${y1} ${x2} ${y2}`,
    { timeoutMs: 10_000 }
  );
  if (isExecError(result)) {
    throw new Error(`Swipe ${direction} failed: ${result.message}`);
  }
}

export async function scrollToElement(
  label: string,
  maxScrolls = 10
): Promise<{ found: boolean; scrollsPerformed: number }> {
  // Get screen dims once upfront so swipe doesn't need to query the tree
  const { width, height } = await getScreenDimensions();

  for (let i = 0; i <= maxScrolls; i++) {
    const { elements } = await getAccessibilityTree();
    const result = findElement(elements, label, "fuzzy");
    if (result.found) {
      return { found: true, scrollsPerformed: i };
    }
    if (i < maxScrolls) {
      await swipe("up", 40, width, height);
      // Small delay for scroll animation
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return { found: false, scrollsPerformed: maxScrolls };
}

export type HardwareButton = "home" | "lock" | "rotate_left" | "rotate_right";

export async function pressHardwareButton(
  button: HardwareButton
): Promise<void> {
  // Map to xcrun simctl button names (works without idb)
  const buttonMap: Record<HardwareButton, string | null> = {
    home: "home",
    lock: "lock",
    rotate_left: null,  // handled via xcrun simctl ui
    rotate_right: null,
  };

  if (button === "rotate_left" || button === "rotate_right") {
    const direction = button === "rotate_left" ? "left" : "right";
    const result = await exec(
      `xcrun simctl ui booted rotate ${direction}`,
      { timeoutMs: 10_000 }
    );
    if (isExecError(result)) {
      throw new Error(`Rotate ${direction} failed: ${result.message}`);
    }
    return;
  }

  const simctlBtn = buttonMap[button];
  const result = await exec(
    `xcrun simctl ui booted button ${simctlBtn}`,
    { timeoutMs: 10_000 }
  );
  if (isExecError(result)) {
    throw new Error(`Hardware button "${button}" failed: ${result.message}`);
  }
}

export async function longPress(
  label: string,
  durationMs = 1000
): Promise<void> {
  const idbPath = await requireIdb();
  const { elements } = await getAccessibilityTree();
  const found = findElement(elements, label, "fuzzy");

  if (!found.found || !found.element) {
    throw new Error(
      `Element not found for long press: "${label}". ${found.suggestion ?? ""}`
    );
  }

  const { x, y } = centerOf(found.element);
  const durationSec = (durationMs / 1000).toFixed(2);

  const result = await exec(
    `${idbPath} ui long-press ${x} ${y} ${durationSec}`,
    { timeoutMs: durationMs + 5_000 }
  );
  if (isExecError(result)) {
    throw new Error(`Long press on "${label}" failed: ${result.message}`);
  }
}

export async function drag(
  fromLabel: string,
  toLabel: string
): Promise<void> {
  const idbPath = await requireIdb();
  const { elements } = await getAccessibilityTree();

  const fromResult = findElement(elements, fromLabel, "fuzzy");
  if (!fromResult.found || !fromResult.element) {
    throw new Error(`Drag source not found: "${fromLabel}". ${fromResult.suggestion ?? ""}`);
  }

  const toResult = findElement(elements, toLabel, "fuzzy");
  if (!toResult.found || !toResult.element) {
    throw new Error(`Drag target not found: "${toLabel}". ${toResult.suggestion ?? ""}`);
  }

  const from = centerOf(fromResult.element);
  const to = centerOf(toResult.element);

  const result = await exec(
    `${idbPath} ui swipe ${from.x} ${from.y} ${to.x} ${to.y}`,
    { timeoutMs: 10_000 }
  );
  if (isExecError(result)) {
    throw new Error(`Drag from "${fromLabel}" to "${toLabel}" failed: ${result.message}`);
  }
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const interactionTools: McpToolDef[] = [
  {
    name: "tap_by_label",
    description:
      "Primary tap method. Finds a UI element by label (fuzzy-matched), calculates its center, and taps it. " +
      "Set fallback_screenshot=true to receive a screenshot when the element isn't found, " +
      "so you can decide the next step visually.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label of the element to tap." },
        fallback_screenshot: {
          type: "boolean",
          description: "If true, take a screenshot when element is not found.",
        },
      },
      required: ["label"],
    },
    handler: async (args) => {
      const label = args["label"] as string;
      const fallback = (args["fallback_screenshot"] as boolean | undefined) ?? false;
      try {
        return await tapByLabel(label, fallback);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "tap_at",
    description:
      "Taps at explicit screen coordinates. Use only when tap_by_label fails — prefer label-based tapping. " +
      "Coordinates are in logical points (not pixels).",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Horizontal coordinate in logical points." },
        y: { type: "number", description: "Vertical coordinate in logical points." },
      },
      required: ["x", "y"],
    },
    handler: async (args) => {
      const x = args["x"] as number;
      const y = args["y"] as number;
      try {
        await tapAt(x, y);
        return toolOk({ success: true, x, y });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "input_text",
    description:
      "Types text into the currently focused element. " +
      "Tap the target field first if it is not already focused. " +
      "Set clear_first=true to erase existing content before typing (sends 100 delete key events).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type." },
        clear_first: {
          type: "boolean",
          description: "If true, clears existing text before typing. Default: false.",
        },
      },
      required: ["text"],
    },
    handler: async (args) => {
      const text = args["text"] as string;
      const clearFirst = (args["clear_first"] as boolean | undefined) ?? false;
      try {
        await inputText(text, clearFirst);
        return toolOk({ success: true, text, cleared: clearFirst });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "swipe",
    description:
      "Performs a swipe gesture. " +
      "Directions: up = scroll down content, down = scroll up content, left/right = horizontal swipe. " +
      "distance_percent (0–100) controls how far the gesture travels across the screen. Default: 50.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Direction to swipe.",
        },
        distance_percent: {
          type: "number",
          description: "Swipe distance as % of screen dimension (0–100). Default: 50.",
        },
      },
      required: ["direction"],
    },
    handler: async (args) => {
      const direction = args["direction"] as SwipeDirection;
      const distance = (args["distance_percent"] as number | undefined) ?? 50;
      try {
        await swipe(direction, distance);
        return toolOk({ success: true, direction, distance_percent: distance });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "scroll_to_element",
    description:
      "Scrolls down repeatedly until the named element appears in the accessibility tree. " +
      "Stops after max_scrolls to prevent infinite scrolling. " +
      "Returns { found, scrolls_performed }.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Element label to scroll to." },
        max_scrolls: {
          type: "number",
          description: "Maximum scroll attempts before giving up. Default: 10.",
        },
      },
      required: ["label"],
    },
    handler: async (args) => {
      const label = args["label"] as string;
      const maxScrolls = (args["max_scrolls"] as number | undefined) ?? 10;
      try {
        const result = await scrollToElement(label, maxScrolls);
        return toolOk(result);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "press_hardware_button",
    description:
      "Simulates a hardware button press on the simulator. " +
      "Buttons: 'home' (go to home screen), 'lock' (lock screen), " +
      "'rotate_left' / 'rotate_right' (change device orientation).",
    inputSchema: {
      type: "object",
      properties: {
        button: {
          type: "string",
          enum: ["home", "lock", "rotate_left", "rotate_right"],
          description: "The hardware button to press.",
        },
      },
      required: ["button"],
    },
    handler: async (args) => {
      const button = args["button"] as HardwareButton;
      try {
        await pressHardwareButton(button);
        return toolOk({ success: true, button });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "long_press",
    description:
      "Performs a long press on the element with the given label. " +
      "Useful for triggering context menus, reorder handles, or haptic-feedback actions. " +
      "Default duration: 1000ms.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label of the element to long-press." },
        duration_ms: {
          type: "number",
          description: "Press duration in milliseconds. Default: 1000.",
        },
      },
      required: ["label"],
    },
    handler: async (args) => {
      const label = args["label"] as string;
      const duration = (args["duration_ms"] as number | undefined) ?? 1000;
      try {
        await longPress(label, duration);
        return toolOk({ success: true, label, duration_ms: duration });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "drag",
    description:
      "Drags from one element to another by label. Useful for reordering lists, " +
      "drag-and-drop interactions, or custom gesture controls.",
    inputSchema: {
      type: "object",
      properties: {
        from_label: {
          type: "string",
          description: "Label of the element to drag from.",
        },
        to_label: {
          type: "string",
          description: "Label of the element to drag to.",
        },
      },
      required: ["from_label", "to_label"],
    },
    handler: async (args) => {
      const fromLabel = args["from_label"] as string;
      const toLabel = args["to_label"] as string;
      try {
        await drag(fromLabel, toLabel);
        return toolOk({ success: true, from: fromLabel, to: toLabel });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },
];
