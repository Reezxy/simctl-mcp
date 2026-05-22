import sharp from "sharp";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  processScreenshot,
  diffScreenshots,
  getScreenshotStats,
} from "../engine/screenshot-processor.js";

// ── Test image helpers ────────────────────────────────────────────────────────

/** Creates a solid-colour PNG of given dimensions and writes to tmpdir. */
async function makePng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Promise<string> {
  const filePath = path.join(os.tmpdir(), `test_${Date.now()}_${Math.random()}.png`);
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(filePath);
  return filePath;
}

// Override screenshots dir to a temp location so tests don't pollute the repo
const TEST_SCREENSHOTS_DIR = path.join(os.tmpdir(), `ss_test_${Date.now()}`);

// Monkey-patch the module-level constant via re-export is not straightforward;
// instead, we confirm saved files land somewhere under os.tmpdir by checking
// the returned filePath exists.

afterAll(async () => {
  // clean up any screenshots written by tests
  try {
    const files = await fs.readdir("./screenshots").catch(() => []);
    for (const f of files) {
      if (f.startsWith("screenshot_") || f.startsWith("diff_")) {
        await fs.unlink(`./screenshots/${f}`).catch(() => {});
      }
    }
  } catch { /* ignore */ }
});

// ── processScreenshot ─────────────────────────────────────────────────────────

describe("processScreenshot", () => {
  it("converts a PNG to JPEG and returns base64", async () => {
    const src = await makePng(200, 400, 100, 150, 200);
    const result = await processScreenshot(src);

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.base64.length).toBeGreaterThan(0);
    expect(result.width).toBe(200);
    expect(result.height).toBe(400);
    expect(result.fileSize).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeGreaterThan(0);

    // File must exist on disk
    await expect(fs.access(result.filePath)).resolves.toBeUndefined();

    await fs.unlink(src);
    await fs.unlink(result.filePath).catch(() => {});
  });

  it("downscales images wider than 1024px", async () => {
    const src = await makePng(2048, 1024, 200, 200, 200);
    const result = await processScreenshot(src, "WideScreen");

    expect(result.width).toBeLessThanOrEqual(1024);
    // Height should scale proportionally
    expect(result.height).toBe(512);

    await fs.unlink(src);
    await fs.unlink(result.filePath).catch(() => {});
  });

  it("does not upscale images smaller than 1024px", async () => {
    const src = await makePng(390, 844, 255, 0, 0);
    const result = await processScreenshot(src);

    expect(result.width).toBe(390);
    expect(result.height).toBe(844);

    await fs.unlink(src);
    await fs.unlink(result.filePath).catch(() => {});
  });

  it("includes the screen name in the filename", async () => {
    const src = await makePng(100, 200, 0, 255, 0);
    const result = await processScreenshot(src, "HomeScreen");

    expect(path.basename(result.filePath)).toContain("HomeScreen");

    await fs.unlink(src);
    await fs.unlink(result.filePath).catch(() => {});
  });
});

// ── diffScreenshots ───────────────────────────────────────────────────────────

describe("diffScreenshots", () => {
  it("reports matches=true for identical images", async () => {
    const a = await makePng(100, 100, 128, 128, 128);
    const b = await makePng(100, 100, 128, 128, 128);

    const result = await diffScreenshots(a, b);
    expect(result.matches).toBe(true);
    expect(result.diffPercent).toBe(0);
    expect(result.diffPixels).toBe(0);

    await fs.unlink(a);
    await fs.unlink(b);
    await fs.unlink(result.diffImagePath).catch(() => {});
  });

  it("reports matches=false for completely different images", async () => {
    const a = await makePng(100, 100, 255, 0, 0);   // red
    const b = await makePng(100, 100, 0, 0, 255);   // blue

    const result = await diffScreenshots(a, b);
    expect(result.matches).toBe(false);
    expect(result.diffPercent).toBeCloseTo(100, 0);
    expect(result.diffPixels).toBe(result.totalPixels);

    await fs.unlink(a);
    await fs.unlink(b);
    await fs.unlink(result.diffImagePath).catch(() => {});
  });

  it("respects custom threshold", async () => {
    // 50% of pixels differ
    const basePixels = Buffer.alloc(100 * 100 * 3, 0); // all black
    const cmpPixels = Buffer.alloc(100 * 100 * 3);
    for (let i = 0; i < cmpPixels.length; i += 6) {
      cmpPixels[i] = 255; // first pixel red
      cmpPixels[i + 1] = 0;
      cmpPixels[i + 2] = 0;
      // second pixel stays 0 (black)
    }

    const a = path.join(os.tmpdir(), `base_${Date.now()}.png`);
    const b = path.join(os.tmpdir(), `cmp_${Date.now()}.png`);
    await sharp(basePixels, { raw: { width: 100, height: 100, channels: 3 } }).png().toFile(a);
    await sharp(cmpPixels, { raw: { width: 100, height: 100, channels: 3 } }).png().toFile(b);

    // With default 2% threshold: should not match (50% diff)
    const strict = await diffScreenshots(a, b, 2);
    expect(strict.matches).toBe(false);

    // With 60% threshold: should match
    const loose = await diffScreenshots(a, b, 60);
    expect(loose.matches).toBe(true);

    await fs.unlink(a);
    await fs.unlink(b);
    await fs.unlink(strict.diffImagePath).catch(() => {});
    await fs.unlink(loose.diffImagePath).catch(() => {});
  });

  it("saves a PNG diff image to disk", async () => {
    const a = await makePng(50, 50, 255, 0, 0);
    const b = await makePng(50, 50, 0, 255, 0);

    const result = await diffScreenshots(a, b);
    await expect(fs.access(result.diffImagePath)).resolves.toBeUndefined();

    const meta = await sharp(result.diffImagePath).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(50);

    await fs.unlink(a);
    await fs.unlink(b);
    await fs.unlink(result.diffImagePath).catch(() => {});
  });
});

// ── getScreenshotStats ────────────────────────────────────────────────────────

describe("getScreenshotStats", () => {
  it("returns correct dimensions and positive token estimate", async () => {
    const src = await makePng(390, 844, 0, 128, 255);
    // Save as JPEG first (simulate processed screenshot)
    const jpegPath = path.join(os.tmpdir(), `stats_test_${Date.now()}.jpg`);
    await sharp(src).jpeg({ quality: 85 }).toFile(jpegPath);

    const stats = await getScreenshotStats(jpegPath);
    expect(stats.width).toBe(390);
    expect(stats.height).toBe(844);
    expect(stats.fileSize).toBeGreaterThan(0);
    expect(stats.estimatedTokens).toBeGreaterThan(0);
    expect(stats.mimeType).toBe("image/jpeg");

    await fs.unlink(src);
    await fs.unlink(jpegPath);
  });

  it("detects PNG mime type", async () => {
    const src = await makePng(100, 100, 0, 0, 0);
    const stats = await getScreenshotStats(src);
    expect(stats.mimeType).toBe("image/png");
    await fs.unlink(src);
  });
});
