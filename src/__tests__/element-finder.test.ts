import {
  findElement,
  filterInteractive,
  extractVisibleText,
} from "../engine/element-finder.js";
import type { UIElement } from "../types.js";

function el(
  label: string,
  type = "Button",
  opts: Partial<UIElement> = {}
): UIElement {
  return {
    label,
    type,
    value: opts.value,
    frame: opts.frame ?? { x: 0, y: 0, width: 80, height: 44 },
    enabled: opts.enabled ?? true,
    visible: opts.visible ?? true,
    depth: opts.depth ?? 1,
    parent_label: opts.parent_label,
    children_count: opts.children_count ?? 0,
  };
}

const ELEMENTS: UIElement[] = [
  el("Sign In", "Button"),
  el("Email", "TextField", { value: "test@example.com" }),
  el("Password", "SecureTextField"),
  el("Forgot Password?", "Button"),
  el("Create Account", "Button"),
  el("Welcome back", "StaticText"),
  el("Disabled Btn", "Button", { enabled: false }),
  el("Hidden Item", "StaticText", { visible: false }),
];

// ── findElement — label ────────────────────────────────────────────────────────

describe("findElement — label strategy", () => {
  it("finds exact label match", () => {
    const r = findElement(ELEMENTS, "Sign In", "label");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Sign In");
    expect(r.confidence).toBe(1);
  });

  it("finds case-insensitive substring", () => {
    const r = findElement(ELEMENTS, "forgot", "label");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Forgot Password?");
    expect(r.confidence).toBe(0.8);
  });

  it("returns found=false when nothing matches", () => {
    const r = findElement(ELEMENTS, "Nonexistent XYZ", "label");
    expect(r.found).toBe(false);
    expect(r.element).toBeUndefined();
    expect(r.suggestion).toBeTruthy();
  });
});

// ── findElement — type ────────────────────────────────────────────────────────

describe("findElement — type strategy", () => {
  it("finds by exact type", () => {
    const r = findElement(ELEMENTS, "TextField", "type");
    expect(r.found).toBe(true);
    expect(r.element?.type).toBe("TextField");
  });

  it("is case-insensitive", () => {
    const r = findElement(ELEMENTS, "button", "type");
    expect(r.found).toBe(true);
    expect(r.element?.type.toLowerCase()).toBe("button");
  });

  it("returns found=false for unknown type", () => {
    const r = findElement(ELEMENTS, "VideoPlayer", "type");
    expect(r.found).toBe(false);
  });
});

// ── findElement — value ───────────────────────────────────────────────────────

describe("findElement — value strategy", () => {
  it("finds element by value", () => {
    const r = findElement(ELEMENTS, "test@example.com", "value");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Email");
  });

  it("finds by partial value", () => {
    const r = findElement(ELEMENTS, "example.com", "value");
    expect(r.found).toBe(true);
    expect(r.confidence).toBe(0.8);
  });

  it("returns found=false when no element has a matching value", () => {
    const r = findElement(ELEMENTS, "hunter2", "value");
    expect(r.found).toBe(false);
  });
});

// ── findElement — fuzzy ───────────────────────────────────────────────────────

describe("findElement — fuzzy strategy", () => {
  it("handles small capitalisation differences", () => {
    const r = findElement(ELEMENTS, "sign in", "fuzzy");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Sign In");
  });

  it("handles minor typos", () => {
    const r = findElement(ELEMENTS, "Signn In", "fuzzy");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Sign In");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("finds via value when label doesn't match", () => {
    const r = findElement(ELEMENTS, "test@example.com", "fuzzy");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Email");
  });

  it("returns found=false when confidence is below threshold", () => {
    const r = findElement([el("Submit", "Button")], "ZZZZZZZ", "fuzzy");
    expect(r.found).toBe(false);
  });

  it("defaults to fuzzy when no strategy supplied", () => {
    const r = findElement(ELEMENTS, "Create Account");
    expect(r.found).toBe(true);
    expect(r.element?.label).toBe("Create Account");
  });
});

// ── filterInteractive ─────────────────────────────────────────────────────────

describe("filterInteractive", () => {
  it("includes enabled visible buttons", () => {
    const result = filterInteractive(ELEMENTS);
    const labels = result.map((e) => e.label);
    expect(labels).toContain("Sign In");
    expect(labels).toContain("Create Account");
  });

  it("excludes disabled elements", () => {
    const result = filterInteractive(ELEMENTS);
    expect(result.find((e) => e.label === "Disabled Btn")).toBeUndefined();
  });

  it("excludes invisible elements", () => {
    const result = filterInteractive(ELEMENTS);
    expect(result.find((e) => e.label === "Hidden Item")).toBeUndefined();
  });

  it("excludes StaticText (not interactive)", () => {
    const result = filterInteractive(ELEMENTS);
    expect(result.find((e) => e.type === "StaticText")).toBeUndefined();
  });

  it("includes text fields and secure fields", () => {
    const result = filterInteractive(ELEMENTS);
    const types = result.map((e) => e.type);
    expect(types).toContain("TextField");
    expect(types).toContain("SecureTextField");
  });
});

// ── extractVisibleText ────────────────────────────────────────────────────────

describe("extractVisibleText", () => {
  it("collects unique visible labels and values", () => {
    const texts = extractVisibleText(ELEMENTS);
    expect(texts).toContain("Sign In");
    expect(texts).toContain("Email");
    expect(texts).toContain("test@example.com");
    expect(texts).toContain("Welcome back");
  });

  it("excludes invisible elements", () => {
    const texts = extractVisibleText(ELEMENTS);
    expect(texts).not.toContain("Hidden Item");
  });

  it("deduplicates repeated text", () => {
    const dupeList: UIElement[] = [
      el("OK", "Button"),
      el("OK", "StaticText"),
    ];
    const texts = extractVisibleText(dupeList);
    expect(texts.filter((t) => t === "OK")).toHaveLength(1);
  });

  it("skips empty labels", () => {
    const texts = extractVisibleText(ELEMENTS);
    expect(texts).not.toContain("");
  });
});
