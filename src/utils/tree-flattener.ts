import type { UIElement } from "../types.js";

// ── Raw idb node (output of `idb ui describe-all`) ────────────────────────────

export interface IdbRawNode {
  type?: string;
  label?: string;
  value?: string | number | boolean | null;
  frame?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    // Some idb versions nest inside origin/size
    origin?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
  };
  enabled?: boolean;
  visible?: boolean;
  children?: IdbRawNode[];
}

export interface FlattenResult {
  elements: UIElement[];
  truncated: boolean;
  totalCount: number;
}

// ── Frame normalisation ───────────────────────────────────────────────────────

function parseFrame(raw: IdbRawNode["frame"]): UIElement["frame"] {
  if (!raw) return { x: 0, y: 0, width: 0, height: 0 };

  // Flat format: { x, y, width, height }
  if (
    typeof raw.x === "number" &&
    typeof raw.y === "number" &&
    typeof raw.width === "number" &&
    typeof raw.height === "number"
  ) {
    return { x: raw.x, y: raw.y, width: raw.width, height: raw.height };
  }

  // Nested format: { origin: { x, y }, size: { width, height } }
  return {
    x: raw.origin?.x ?? 0,
    y: raw.origin?.y ?? 0,
    width: raw.size?.width ?? 0,
    height: raw.size?.height ?? 0,
  };
}

function valueToString(
  v: IdbRawNode["value"]
): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v || undefined;
  return String(v);
}

// ── Recursive flattener ───────────────────────────────────────────────────────

const MAX_ELEMENTS = 500;

function walk(
  node: IdbRawNode,
  depth: number,
  parentLabel: string | undefined,
  out: UIElement[],
  counter: { count: number }
): void {
  if (counter.count >= MAX_ELEMENTS) return;

  const element: UIElement = {
    label: node.label ?? "",
    type: node.type ?? "Unknown",
    value: valueToString(node.value),
    frame: parseFrame(node.frame),
    enabled: node.enabled !== false, // default true if missing
    visible: node.visible !== false, // default true if missing
    depth,
    parent_label: parentLabel,
    children_count: node.children?.length ?? 0,
  };

  out.push(element);
  counter.count++;

  const children = node.children ?? [];
  for (const child of children) {
    walk(child, depth + 1, element.label || parentLabel, out, counter);
    if (counter.count >= MAX_ELEMENTS) return;
  }
}

/**
 * Flattens a nested idb accessibility tree into a flat UIElement array.
 * Caps at 500 elements and sets `truncated: true` if the tree was larger.
 */
export function flattenTree(root: IdbRawNode): FlattenResult {
  const elements: UIElement[] = [];
  const counter = { count: 0 };

  // Count total nodes for the summary (fast, separate pass only when needed)
  let totalCount = 0;
  function countNodes(node: IdbRawNode): void {
    totalCount++;
    for (const child of node.children ?? []) countNodes(child);
  }
  countNodes(root);

  walk(root, 0, undefined, elements, counter);

  return {
    elements,
    truncated: totalCount > MAX_ELEMENTS,
    totalCount,
  };
}

/**
 * Parses the raw string output of `idb ui describe-all`.
 * idb emits either a single JSON object or a JSON array with one root element.
 */
export function parseIdbOutput(raw: string): FlattenResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { elements: [], truncated: false, totalCount: 0 };
  }

  let root: IdbRawNode;
  const parsed: unknown = JSON.parse(trimmed);

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { elements: [], truncated: false, totalCount: 0 };
    }
    root = parsed[0] as IdbRawNode;
  } else {
    root = parsed as IdbRawNode;
  }

  return flattenTree(root);
}
