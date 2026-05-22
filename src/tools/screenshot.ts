import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { exec, isExecError } from "../utils/exec.js";
import {
  processScreenshot,
  diffScreenshots,
  getScreenshotStats,
} from "../engine/screenshot-processor.js";
import { toolError, toolOk } from "../types.js";
import type { McpToolDef, McpToolResult } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function captureRawPng(screenName?: string): Promise<string> {
  const slug = screenName
    ? `_${screenName.replace(/[^a-zA-Z0-9]/g, "_")}`
    : "";
  const tmpPath = path.join(os.tmpdir(), `sim_raw${slug}_${Date.now()}.png`);

  const result = await exec(
    `xcrun simctl io booted screenshot "${tmpPath}"`,
    { timeoutMs: 15_000 }
  );

  if (isExecError(result)) {
    throw new Error(
      `Screenshot capture failed: ${result.message}. ` +
        "Ensure a simulator is booted (xcrun simctl list devices booted)."
    );
  }

  return tmpPath;
}

async function cleanupTmp(tmpPath: string): Promise<void> {
  try {
    await fs.unlink(tmpPath);
  } catch {
    // best-effort
  }
}

// ── Core logic (exported for tests) ──────────────────────────────────────────

export async function takeScreenshot(screenName?: string): Promise<McpToolResult> {
  const tmpPng = await captureRawPng(screenName);
  try {
    const processed = await processScreenshot(tmpPng, screenName);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              filePath: processed.filePath,
              width: processed.width,
              height: processed.height,
              fileSize: processed.fileSize,
              estimatedTokens: processed.estimatedTokens,
            },
            null,
            2
          ),
        },
        {
          type: "image",
          data: processed.base64,
          mimeType: processed.mimeType,
        },
      ],
    };
  } finally {
    await cleanupTmp(tmpPng);
  }
}

export async function compareScreenshot(
  baselinePath: string,
  thresholdPercent = 2
): Promise<McpToolResult> {
  // Take fresh screenshot and diff against baseline
  const tmpPng = await captureRawPng();
  try {
    const result = await diffScreenshots(baselinePath, tmpPng, thresholdPercent);
    return toolOk(result);
  } finally {
    await cleanupTmp(tmpPng);
  }
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const screenshotTools: McpToolDef[] = [
  {
    name: "take_screenshot",
    description:
      "Captures the current simulator screen. Returns the image directly so you can see it visually, " +
      "plus metadata (file path, dimensions, estimated token cost). " +
      "Call wait_for_screen_stable first if animations may be in progress. " +
      "Use screen_name to give the saved file a meaningful name.",
    inputSchema: {
      type: "object",
      properties: {
        screen_name: {
          type: "string",
          description:
            "Optional name for the screen — used in the saved filename, e.g. 'HomeScreen'.",
        },
      },
    },
    handler: async (args) => {
      const screenName = args["screen_name"] as string | undefined;
      try {
        return await takeScreenshot(screenName);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "diff_screenshots",
    description:
      "Pixel-by-pixel diff of a previously saved screenshot against the current screen. " +
      "Returns { matches, diff_percent, diff_image_path, total_pixels, diff_pixels }. " +
      "Diff pixels are highlighted red in the output image. " +
      "Use for visual regression: save a baseline after a known-good state, then compare later.",
    inputSchema: {
      type: "object",
      properties: {
        baseline_path: {
          type: "string",
          description: "File path to the baseline screenshot (JPEG or PNG).",
        },
        threshold_percent: {
          type: "number",
          description:
            "Maximum allowed diff percentage to be considered matching. Default: 2.",
        },
      },
      required: ["baseline_path"],
    },
    handler: async (args) => {
      const baselinePath = args["baseline_path"] as string;
      const threshold = (args["threshold_percent"] as number | undefined) ?? 2;
      try {
        return await compareScreenshot(baselinePath, threshold);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "get_screenshot_stats",
    description:
      "Returns dimensions, file size, MIME type, and estimated Claude token cost for a saved screenshot file.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the screenshot file.",
        },
      },
      required: ["file_path"],
    },
    handler: async (args) => {
      const filePath = args["file_path"] as string;
      try {
        const stats = await getScreenshotStats(filePath);
        return toolOk(stats);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },
];
