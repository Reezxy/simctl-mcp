import { flattenTree, parseIdbOutput } from "../utils/tree-flattener.js";
import type { IdbRawNode } from "../utils/tree-flattener.js";

// ── flattenTree ───────────────────────────────────────────────────────────────

describe("flattenTree", () => {
  it("flattens a single-node tree", () => {
    const root: IdbRawNode = {
      type: "Application",
      label: "MyApp",
      frame: { x: 0, y: 0, width: 390, height: 844 },
      enabled: true,
      visible: true,
      children: [],
    };

    const { elements, truncated, totalCount } = flattenTree(root);
    expect(elements).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(totalCount).toBe(1);
    expect(elements[0]).toMatchObject({
      label: "MyApp",
      type: "Application",
      depth: 0,
      children_count: 0,
      parent_label: undefined,
    });
  });

  it("assigns correct depth and parent_label", () => {
    const root: IdbRawNode = {
      type: "Window",
      label: "Root",
      frame: { x: 0, y: 0, width: 390, height: 844 },
      enabled: true,
      visible: true,
      children: [
        {
          type: "Button",
          label: "Tap me",
          frame: { x: 10, y: 20, width: 80, height: 44 },
          enabled: true,
          visible: true,
          children: [
            {
              type: "StaticText",
              label: "Tap me",
              frame: { x: 10, y: 20, width: 80, height: 20 },
              enabled: true,
              visible: true,
              children: [],
            },
          ],
        },
      ],
    };

    const { elements } = flattenTree(root);
    expect(elements).toHaveLength(3);

    expect(elements[0]).toMatchObject({ depth: 0, parent_label: undefined });
    expect(elements[1]).toMatchObject({ depth: 1, parent_label: "Root" });
    expect(elements[2]).toMatchObject({ depth: 2, parent_label: "Tap me" });
  });

  it("normalises nested origin/size frame format", () => {
    const root: IdbRawNode = {
      type: "Button",
      label: "OK",
      frame: {
        origin: { x: 100, y: 200 },
        size: { width: 80, height: 44 },
      },
      enabled: true,
      visible: true,
      children: [],
    };

    const { elements } = flattenTree(root);
    expect(elements[0].frame).toEqual({ x: 100, y: 200, width: 80, height: 44 });
  });

  it("defaults enabled/visible to true when absent", () => {
    const root: IdbRawNode = {
      type: "StaticText",
      label: "Hello",
      children: [],
    };

    const { elements } = flattenTree(root);
    expect(elements[0].enabled).toBe(true);
    expect(elements[0].visible).toBe(true);
  });

  it("converts numeric value to string", () => {
    const root: IdbRawNode = {
      type: "Slider",
      label: "Volume",
      value: 0.75,
      children: [],
    };
    const { elements } = flattenTree(root);
    expect(elements[0].value).toBe("0.75");
  });

  it("sets truncated=true and stops at 500 elements", () => {
    // Build a tree with 600 leaf nodes
    const children: IdbRawNode[] = Array.from({ length: 600 }, (_, i) => ({
      type: "Button",
      label: `Btn${i}`,
      children: [],
    }));
    const root: IdbRawNode = {
      type: "Application",
      label: "App",
      children,
    };

    const { elements, truncated, totalCount } = flattenTree(root);
    expect(elements).toHaveLength(500);
    expect(truncated).toBe(true);
    expect(totalCount).toBe(601); // root + 600 children
  });

  it("reports truncated=false when tree is exactly 500 nodes", () => {
    const children: IdbRawNode[] = Array.from({ length: 499 }, (_, i) => ({
      type: "Button",
      label: `Btn${i}`,
      children: [],
    }));
    const root: IdbRawNode = { type: "Application", label: "App", children };

    const { elements, truncated } = flattenTree(root);
    expect(elements).toHaveLength(500);
    expect(truncated).toBe(false);
  });
});

// ── parseIdbOutput ─────────────────────────────────────────────────────────────

describe("parseIdbOutput", () => {
  it("parses a JSON-object root", () => {
    const json = JSON.stringify({
      type: "Application",
      label: "MyApp",
      children: [],
    });
    const { elements } = parseIdbOutput(json);
    expect(elements).toHaveLength(1);
    expect(elements[0].label).toBe("MyApp");
  });

  it("parses a JSON-array root (some idb versions)", () => {
    const json = JSON.stringify([
      { type: "Application", label: "App", children: [] },
    ]);
    const { elements } = parseIdbOutput(json);
    expect(elements).toHaveLength(1);
  });

  it("returns empty result for empty string", () => {
    const { elements, truncated } = parseIdbOutput("   ");
    expect(elements).toHaveLength(0);
    expect(truncated).toBe(false);
  });

  it("returns empty result for empty array", () => {
    const { elements } = parseIdbOutput("[]");
    expect(elements).toHaveLength(0);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseIdbOutput("{not json")).toThrow();
  });
});
