import sharp from "sharp";
import * as fs from "fs/promises";
import * as path from "path";

const MAX_WIDTH = 1024;
const JPEG_QUALITY = 85;
// Rough token estimate: Claude counts image tokens based on tile grid.
// One 512×512 tile ≈ 170 tokens. We compute tiles needed for the image.
const TILE_SIZE = 512;
const TOKENS_PER_TILE = 170;
const BASE_TOKENS = 85;

export const SCREENSHOTS_DIR = "./screenshots";

// ── Result types ──────────────────────────────────────────────────────────────

export interface ProcessedScreenshot {
  filePath: string;
  base64: string;
  width: number;
  height: number;
  fileSize: number;
  estimatedTokens: number;
  mimeType: "image/jpeg";
}

export interface DiffResult {
  matches: boolean;
  diffPercent: number;
  diffImagePath: string;
  totalPixels: number;
  diffPixels: number;
}

export interface ScreenshotStats {
  filePath: string;
  width: number;
  height: number;
  fileSize: number;
  estimatedTokens: number;
  mimeType: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateTokens(width: number, height: number): number {
  const tilesX = Math.ceil(width / TILE_SIZE);
  const tilesY = Math.ceil(height / TILE_SIZE);
  return BASE_TOKENS + tilesX * tilesY * TOKENS_PER_TILE;
}

function timestampedFilename(screenName?: string): string {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .slice(0, 15); // YYYYMMdd_HHmmss
  const slug = screenName
    ? `_${screenName.replace(/[^a-zA-Z0-9]/g, "_")}`
    : "";
  return `screenshot_${ts}${slug}.jpg`;
}

async function ensureScreenshotsDir(): Promise<void> {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resizes a raw PNG screenshot (from simctl/idb) to max 1024px wide,
 * converts to JPEG at 85% quality, saves to ./screenshots/, and returns
 * the processed result including base64 and token estimate.
 */
export async function processScreenshot(
  sourcePngPath: string,
  screenName?: string
): Promise<ProcessedScreenshot> {
  await ensureScreenshotsDir();

  const filename = timestampedFilename(screenName);
  const destPath = path.join(SCREENSHOTS_DIR, filename);

  const image = sharp(sourcePngPath);
  const metadata = await image.metadata();
  const sourceWidth = metadata.width ?? 0;

  let pipeline = image;
  if (sourceWidth > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  const { data: jpegBuffer, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });

  await fs.writeFile(destPath, jpegBuffer);

  const base64 = jpegBuffer.toString("base64");
  const estimatedTokens = estimateTokens(info.width, info.height);

  return {
    filePath: destPath,
    base64,
    width: info.width,
    height: info.height,
    fileSize: jpegBuffer.length,
    estimatedTokens,
    mimeType: "image/jpeg",
  };
}

/**
 * Pixel-by-pixel diff of two saved screenshot files.
 * Both images are resized to the same dimensions before comparison.
 * Diff pixels (channel delta ≥ 30) are highlighted red in the output image.
 */
export async function diffScreenshots(
  baselinePath: string,
  comparePath: string,
  thresholdPercent = 2
): Promise<DiffResult> {
  await ensureScreenshotsDir();

  // Load both images, normalise to same size (baseline dimensions)
  const baseImg = sharp(baselinePath);
  const baseMeta = await baseImg.metadata();
  const w = baseMeta.width ?? MAX_WIDTH;
  const h = baseMeta.height ?? 0;

  const [baseRaw, compareRaw] = await Promise.all([
    baseImg
      .resize({ width: w, height: h, fit: "fill" })
      .raw()
      .toBuffer(),
    sharp(comparePath)
      .resize({ width: w, height: h, fit: "fill" })
      .raw()
      .toBuffer(),
  ]);

  const channels = 3; // RGB from raw()
  const totalPixels = w * h;
  const diffBuffer = Buffer.alloc(baseRaw.length);
  let diffPixels = 0;

  for (let i = 0; i < baseRaw.length; i += channels) {
    const dr = Math.abs(baseRaw[i]! - compareRaw[i]!);
    const dg = Math.abs(baseRaw[i + 1]! - compareRaw[i + 1]!);
    const db = Math.abs(baseRaw[i + 2]! - compareRaw[i + 2]!);

    if (dr > 30 || dg > 30 || db > 30) {
      diffPixels++;
      // Highlight in red
      diffBuffer[i] = 255;
      diffBuffer[i + 1] = 0;
      diffBuffer[i + 2] = 0;
    } else {
      // Dimmed copy of original
      diffBuffer[i] = Math.floor(baseRaw[i]! * 0.5);
      diffBuffer[i + 1] = Math.floor(baseRaw[i + 1]! * 0.5);
      diffBuffer[i + 2] = Math.floor(baseRaw[i + 2]! * 0.5);
    }
  }

  const diffPercent = (diffPixels / totalPixels) * 100;
  const matches = diffPercent <= thresholdPercent;

  const diffFilename = `diff_${Date.now()}.png`;
  const diffImagePath = path.join(SCREENSHOTS_DIR, diffFilename);

  await sharp(diffBuffer, { raw: { width: w, height: h, channels } })
    .png()
    .toFile(diffImagePath);

  return { matches, diffPercent, diffImagePath, totalPixels, diffPixels };
}

/**
 * Returns dimensions, file size, and token estimate for an existing screenshot.
 */
export async function getScreenshotStats(
  filePath: string
): Promise<ScreenshotStats> {
  const metadata = await sharp(filePath).metadata();
  const stat = await fs.stat(filePath);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const mimeType =
    metadata.format === "png" ? "image/png" : "image/jpeg";

  return {
    filePath,
    width,
    height,
    fileSize: stat.size,
    estimatedTokens: estimateTokens(width, height),
    mimeType,
  };
}
