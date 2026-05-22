import { jest } from "@jest/globals";
import type { UIElement } from "../types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetAccessibilityTree = jest.fn<
  () => Promise<{ elements: UIElement[]; truncated: boolean; totalCount: number }>
>();

jest.unstable_mockModule("../tools/accessibility.js", () => ({
  getAccessibilityTree: mockGetAccessibilityTree,
  describeCurrentScreen: jest.fn(),
  accessibilityTools: [],
}));

const mockCaptureRawPng = jest.fn<() => Promise<string>>();
jest.unstable_mockModule("../tools/screenshot.js", () => ({
  captureRawPng: mockCaptureRawPng,
  takeScreenshot: jest.fn(),
  compareScreenshot: jest.fn(),
  screenshotTools: [],
}));

const mockDiffScreenshots = jest.fn<
  () => Promise<{
    matches: boolean;
    diffPercent: number;
    diffImagePath: string;
    totalPixels: number;
    diffPixels: number;
  }>
>();
jest.unstable_mockModule("../engine/screenshot-processor.js", () => ({
  diffScreenshots: mockDiffScreenshots,
  processScreenshot: jest.fn(),
  getScreenshotStats: jest.fn(),
  SCREENSHOTS_DIR: "./screenshots",
}));

// fs.unlink for temp file cleanup
jest.unstable_mockModule("fs/promises", () => ({
  unlink: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mkdir: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  writeFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  stat: jest.fn(),
  readdir: jest.fn(),
  access: jest.fn(),
}));

const { waitForElement, waitForScreenStable, waitForElementGone } =
  await import("../tools/wait.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(label: string): UIElement {
  return {
    label,
    type: "Button",
    frame: { x: 0, y: 0, width: 80, height: 44 },
    enabled: true,
    visible: true,
    depth: 1,
    children_count: 0,
  };
}

function tree(...labels: string[]) {
  return {
    elements: labels.map(el),
    truncated: false,
    totalCount: labels.length,
  };
}

function stableDiff(): ReturnType<typeof mockDiffScreenshots> extends Promise<infer T> ? Promise<T> : never {
  return Promise.resolve({
    matches: true,
    diffPercent: 0.5,
    diffImagePath: "/tmp/diff.png",
    totalPixels: 10000,
    diffPixels: 50,
  }) as any;
}

function unstableDiff(diffPercent = 15): ReturnType<typeof mockDiffScreenshots> extends Promise<infer T> ? Promise<T> : never {
  return Promise.resolve({
    matches: false,
    diffPercent,
    diffImagePath: "/tmp/diff.png",
    totalPixels: 10000,
    diffPixels: Math.round(10000 * diffPercent / 100),
  }) as any;
}

beforeEach(() => {
  mockGetAccessibilityTree.mockReset();
  mockCaptureRawPng.mockReset();
  mockDiffScreenshots.mockReset();
  jest.useRealTimers();
});

// ── waitForElement ─────────────────────────────────────────────────────────────

describe("waitForElement", () => {
  it("returns found=true immediately when element is present on first poll", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree("Sign In", "Email"));

    const result = await waitForElement("Sign In", 5000, 500);

    expect(result.found).toBe(true);
    expect(result.timed_out).toBeFalsy();
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(mockGetAccessibilityTree).toHaveBeenCalledTimes(1);
  });

  it("polls until the element appears", async () => {
    mockGetAccessibilityTree
      .mockResolvedValueOnce(tree("Loading..."))
      .mockResolvedValueOnce(tree("Loading..."))
      .mockResolvedValueOnce(tree("Home", "Profile"));

    // Use very short poll interval to keep the test fast
    const result = await waitForElement("Home", 10_000, 10);

    expect(result.found).toBe(true);
    expect(mockGetAccessibilityTree).toHaveBeenCalledTimes(3);
  });

  it("returns timed_out=true when element never appears", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree("Nothing"));

    const result = await waitForElement("Missing", 50, 10);

    expect(result.found).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(50);
  });

  it("uses fuzzy matching — finds element despite capitalisation difference", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree("sign in"));

    const result = await waitForElement("Sign In", 1000, 10);
    expect(result.found).toBe(true);
  });
});

// ── waitForScreenStable ────────────────────────────────────────────────────────

describe("waitForScreenStable", () => {
  beforeEach(() => {
    mockCaptureRawPng.mockResolvedValue("/tmp/screen.png");
  });

  it("returns stable=true when screenshots are identical on first check", async () => {
    mockDiffScreenshots.mockImplementation(() => stableDiff());

    const result = await waitForScreenStable(3000);

    expect(result.stable).toBe(true);
    expect(result.final_diff_percent).toBeLessThan(2);
    // Two captures per stability check
    expect(mockCaptureRawPng).toHaveBeenCalledTimes(2);
  });

  it("retries when screen is still changing, returns stable on second check", async () => {
    mockDiffScreenshots
      .mockImplementationOnce(() => unstableDiff(20))
      .mockImplementationOnce(() => stableDiff());

    const result = await waitForScreenStable(10_000);

    expect(result.stable).toBe(true);
    expect(mockCaptureRawPng).toHaveBeenCalledTimes(4); // 2 per check × 2 checks
  });

  it("returns stable=false after timeout", async () => {
    mockDiffScreenshots.mockImplementation(() => unstableDiff(30));

    const result = await waitForScreenStable(100);

    expect(result.stable).toBe(false);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(100);
    expect(result.final_diff_percent).toBeGreaterThan(2);
  });

  it("cleans up both temp PNG files after each comparison", async () => {
    mockCaptureRawPng
      .mockResolvedValueOnce("/tmp/a.png")
      .mockResolvedValueOnce("/tmp/b.png");
    mockDiffScreenshots.mockImplementation(() => stableDiff());

    const fsMod = await import("fs/promises");
    const unlinkSpy = fsMod.unlink as jest.MockedFunction<typeof fsMod.unlink>;
    unlinkSpy.mockClear();

    await waitForScreenStable(3000);

    const unlinkedPaths = unlinkSpy.mock.calls.map((c) => c[0]);
    expect(unlinkedPaths).toContain("/tmp/a.png");
    expect(unlinkedPaths).toContain("/tmp/b.png");
    expect(unlinkedPaths).toContain("/tmp/diff.png"); // diff image cleaned up too
  });
});

// ── waitForElementGone ────────────────────────────────────────────────────────

describe("waitForElementGone", () => {
  it("returns found=false immediately when element is already gone", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree("Home", "Profile"));

    const result = await waitForElementGone("Loading Spinner", 5000);

    expect(result.found).toBe(false);
    expect(result.timed_out).toBeFalsy();
    expect(mockGetAccessibilityTree).toHaveBeenCalledTimes(1);
  });

  it("polls until element disappears", async () => {
    mockGetAccessibilityTree
      .mockResolvedValueOnce(tree("Loading Spinner", "Cancel"))
      .mockResolvedValueOnce(tree("Loading Spinner", "Cancel"))
      .mockResolvedValueOnce(tree("Home", "Profile")); // spinner gone

    const result = await waitForElementGone("Loading Spinner", 10_000, );

    expect(result.found).toBe(false);
    expect(mockGetAccessibilityTree).toHaveBeenCalledTimes(3);
  });

  it("returns timed_out=true when element never disappears", async () => {
    mockGetAccessibilityTree.mockResolvedValue(tree("Persistent Modal"));

    const result = await waitForElementGone("Persistent Modal", 50);

    expect(result.found).toBe(true);
    expect(result.timed_out).toBe(true);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(50);
  });

  it("uses fuzzy matching for the gone check", async () => {
    // Element labelled "Loading..." is considered gone when searching for "Loading"
    mockGetAccessibilityTree.mockResolvedValue(tree("Home"));

    const result = await waitForElementGone("Loading", 1000);
    expect(result.found).toBe(false);
  });
});
