import { jest } from "@jest/globals";
import type { ExecResponse } from "../utils/exec.js";
import type { UIElement } from "../types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockExec = jest.fn<() => Promise<ExecResponse>>();

jest.unstable_mockModule("../utils/exec.js", () => ({
  exec: mockExec,
  execOrThrow: jest.fn(),
  isExecError: (r: unknown) =>
    typeof r === "object" && r !== null && "error" in r,
}));

jest.unstable_mockModule("../utils/idb-check.js", () => ({
  getBackend: jest.fn<() => Promise<{ backend: string; idbPath: string }>>().mockResolvedValue({
    backend: "idb",
    idbPath: "/usr/local/bin/idb",
  }),
  idbCmd: jest.fn(),
  isIdbAvailable: jest.fn(),
  getIdbPath: jest.fn(),
  resetBackendCache: jest.fn(),
}));

const mockGetAccessibilityTree = jest.fn<() => Promise<{ elements: UIElement[]; truncated: boolean; totalCount: number }>>();
jest.unstable_mockModule("../tools/accessibility.js", () => ({
  getAccessibilityTree: mockGetAccessibilityTree,
  describeCurrentScreen: jest.fn(),
  accessibilityTools: [],
}));

jest.unstable_mockModule("../tools/screenshot.js", () => ({
  takeScreenshot: jest.fn<() => Promise<{ content: Array<{ type: string; text?: string }> }>>().mockResolvedValue({
    content: [{ type: "text", text: "{}" }],
  }),
  compareScreenshot: jest.fn(),
  screenshotTools: [],
}));

const {
  tapByLabel,
  tapAt,
  inputText,
  swipe,
  scrollToElement,
  pressHardwareButton,
  longPress,
  drag,
} = await import("../tools/interaction.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(
  label: string,
  x: number,
  y: number,
  w = 80,
  h = 44,
  type = "Button"
): UIElement {
  return {
    label,
    type,
    frame: { x, y, width: w, height: h },
    enabled: true,
    visible: true,
    depth: 1,
    children_count: 0,
  };
}

const ok = (): ExecResponse => ({ stdout: "", stderr: "" });
const err = (msg = "failed"): ExecResponse => ({
  error: true as const,
  message: msg,
  command: "",
});

// Root element with screen bounds (matches DEFAULT_SCREEN_WIDTH × HEIGHT)
const rootEl = (): UIElement => ({
  label: "App",
  type: "Application",
  frame: { x: 0, y: 0, width: 393, height: 852 },
  enabled: true,
  visible: true,
  depth: 0,
  children_count: 1,
});

function treeWith(...elements: UIElement[]): {
  elements: UIElement[];
  truncated: boolean;
  totalCount: number;
} {
  return { elements: [rootEl(), ...elements], truncated: false, totalCount: elements.length + 1 };
}

beforeEach(() => {
  mockExec.mockReset();
  mockGetAccessibilityTree.mockReset();
});

// ── tapByLabel ─────────────────────────────────────────────────────────────────

describe("tapByLabel", () => {
  it("taps the center of the found element", async () => {
    // el at (100, 200, 80, 44) → center = (140, 222)
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Sign In", 100, 200)));
    mockExec.mockResolvedValue(ok());

    const result = await tapByLabel("Sign In");
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.x).toBe(140); // 100 + 80/2
    expect(data.y).toBe(222); // 200 + 44/2
    expect(data.success).toBe(true);

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("ui tap 140 222"),
      expect.anything()
    );
  });

  it("returns error when element not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Home", 0, 0)));

    const result = await tapByLabel("Nonexistent Button");
    expect(result.isError).toBe(true);
  });

  it("includes screenshot content when fallback_screenshot=true and element not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Home", 0, 0)));

    const result = await tapByLabel("Missing", true);
    expect(result.isError).toBe(true);
    // Should include both error text + screenshot image content
    expect(result.content.length).toBeGreaterThanOrEqual(2);
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text).error).toBe(true);
  });

  it("returns toolError when idb exec fails", async () => {
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Sign In", 10, 10)));
    mockExec.mockResolvedValue(err("idb not responding"));

    await expect(tapByLabel("Sign In")).rejects.toThrow("Tap failed");
  });
});

// ── tapAt ─────────────────────────────────────────────────────────────────────

describe("tapAt", () => {
  it("calls idb ui tap with exact coordinates", async () => {
    mockExec.mockResolvedValue(ok());
    await expect(tapAt(200, 300)).resolves.toBeUndefined();
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("ui tap 200 300"),
      expect.anything()
    );
  });

  it("throws on exec error", async () => {
    mockExec.mockResolvedValue(err("timeout"));
    await expect(tapAt(0, 0)).rejects.toThrow("Tap at (0, 0) failed");
  });
});

// ── inputText ─────────────────────────────────────────────────────────────────

describe("inputText", () => {
  it("types text without clearing", async () => {
    mockExec.mockResolvedValue(ok());
    await inputText("hello world");

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('ui type "hello world"'),
      expect.anything()
    );
  });

  it("sends delete key-sequence before typing when clear_first=true", async () => {
    mockExec.mockResolvedValue(ok());
    await inputText("new text", true);

    expect(mockExec).toHaveBeenCalledTimes(2);
    const firstCall = (mockExec.mock.calls[0] as [string])[0];
    expect(firstCall).toContain("key-sequence");
    expect(firstCall).toContain("42"); // HID_DELETE

    const secondCall = (mockExec.mock.calls[1] as [string])[0];
    expect(secondCall).toContain('ui type "new text"');
  });

  it("escapes double-quotes in text", async () => {
    mockExec.mockResolvedValue(ok());
    await inputText('say "hello"');
    const call = (mockExec.mock.calls[0] as [string])[0];
    expect(call).toContain('\\"hello\\"');
  });
});

// ── swipe ─────────────────────────────────────────────────────────────────────

describe("swipe", () => {
  // swipe no longer calls getAccessibilityTree — screen dims are passed directly

  it("swipes upward (scrolls content down)", async () => {
    mockExec.mockResolvedValue(ok());
    await swipe("up", 50);

    const call = (mockExec.mock.calls[0] as [string])[0];
    const parts = call.match(/swipe (\d+) (\d+) (\d+) (\d+)/);
    expect(parts).not.toBeNull();
    const y1 = parseInt(parts![2]!);
    const y2 = parseInt(parts![4]!);
    expect(y2).toBeLessThan(y1);
  });

  it("swipes downward (scrolls content up)", async () => {
    mockExec.mockResolvedValue(ok());
    await swipe("down", 50);

    const call = (mockExec.mock.calls[0] as [string])[0];
    const parts = call.match(/swipe (\d+) (\d+) (\d+) (\d+)/);
    const y1 = parseInt(parts![2]!);
    const y2 = parseInt(parts![4]!);
    expect(y2).toBeGreaterThan(y1);
  });

  it("swipes left", async () => {
    mockExec.mockResolvedValue(ok());
    await swipe("left", 50);

    const call = (mockExec.mock.calls[0] as [string])[0];
    const parts = call.match(/swipe (\d+) (\d+) (\d+) (\d+)/);
    const x1 = parseInt(parts![1]!);
    const x2 = parseInt(parts![3]!);
    expect(x2).toBeLessThan(x1);
  });

  it("clamps end coordinates to screen bounds", async () => {
    mockExec.mockResolvedValue(ok());
    await swipe("up", 200);

    const call = (mockExec.mock.calls[0] as [string])[0];
    const parts = call.match(/swipe (\d+) (\d+) (\d+) (\d+)/);
    const y2 = parseInt(parts![4]!);
    expect(y2).toBeGreaterThanOrEqual(5);
  });
});

// ── scrollToElement ────────────────────────────────────────────────────────────

describe("scrollToElement", () => {
  it("returns found=true immediately when element is visible", async () => {
    // 1st call: getScreenDimensions, 2nd call: check i=0 → found
    mockGetAccessibilityTree
      .mockResolvedValueOnce(treeWith())                        // getScreenDimensions
      .mockResolvedValueOnce(treeWith(el("Submit", 0, 400)));  // check i=0

    mockExec.mockResolvedValue(ok());

    const result = await scrollToElement("Submit", 5);
    expect(result.found).toBe(true);
    expect(result.scrollsPerformed).toBe(0);
  });

  it("scrolls until element appears", async () => {
    // getScreenDimensions; check i=0 → miss; check i=1 → miss; check i=2 → found
    mockGetAccessibilityTree
      .mockResolvedValueOnce(treeWith())                              // getScreenDimensions
      .mockResolvedValueOnce(treeWith(el("Something Else", 0, 0)))  // check i=0 → miss
      .mockResolvedValueOnce(treeWith(el("Something Else", 0, 0)))  // check i=1 → miss
      .mockResolvedValueOnce(treeWith(el("Target", 0, 700)));       // check i=2 → found

    mockExec.mockResolvedValue(ok());

    const result = await scrollToElement("Target", 5);
    expect(result.found).toBe(true);
    expect(result.scrollsPerformed).toBe(2);
  });

  it("returns found=false after exhausting max_scrolls", async () => {
    // getScreenDimensions + 4 checks (i=0..3), all miss
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Nothing", 0, 0)));
    mockExec.mockResolvedValue(ok());

    const result = await scrollToElement("Ghost Element", 3);
    expect(result.found).toBe(false);
    expect(result.scrollsPerformed).toBe(3);
  });
});

// ── pressHardwareButton ────────────────────────────────────────────────────────

describe("pressHardwareButton", () => {
  it("sends home button via xcrun simctl", async () => {
    mockExec.mockResolvedValue(ok());
    await pressHardwareButton("home");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("simctl ui booted button home"),
      expect.anything()
    );
  });

  it("sends lock button via xcrun simctl", async () => {
    mockExec.mockResolvedValue(ok());
    await pressHardwareButton("lock");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("simctl ui booted button lock"),
      expect.anything()
    );
  });

  it("sends rotate via xcrun simctl ui rotate", async () => {
    mockExec.mockResolvedValue(ok());
    await pressHardwareButton("rotate_left");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("simctl ui booted rotate left"),
      expect.anything()
    );
  });
});

// ── longPress ─────────────────────────────────────────────────────────────────

describe("longPress", () => {
  it("calls idb long-press with center coordinates and duration in seconds", async () => {
    // el at (100, 200, 80, 44) → center (140, 222)
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Card Item", 100, 200)));
    mockExec.mockResolvedValue(ok());

    await longPress("Card Item", 1500);

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("long-press 140 222 1.50"),
      expect.anything()
    );
  });

  it("throws when element not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Other", 0, 0)));
    await expect(longPress("Missing")).rejects.toThrow("Element not found for long press");
  });
});

// ── drag ──────────────────────────────────────────────────────────────────────

describe("drag", () => {
  it("swipes between centers of two elements", async () => {
    // from: (0,0,80,44) → center (40, 22)
    // to:   (200,400,80,44) → center (240, 422)
    mockGetAccessibilityTree.mockResolvedValue(
      treeWith(el("Item A", 0, 0), el("Item B", 200, 400))
    );
    mockExec.mockResolvedValue(ok());

    await drag("Item A", "Item B");

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("swipe 40 22 240 422"),
      expect.anything()
    );
  });

  it("throws when source element not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Item B", 0, 0)));
    await expect(drag("Missing Source", "Item B")).rejects.toThrow("Drag source not found");
  });

  it("throws when target element not found", async () => {
    mockGetAccessibilityTree.mockResolvedValue(treeWith(el("Item A", 0, 0)));
    await expect(drag("Item A", "Missing Target")).rejects.toThrow("Drag target not found");
  });
});
