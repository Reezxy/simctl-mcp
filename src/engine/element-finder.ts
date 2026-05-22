import { distance } from "fastest-levenshtein";
import type { UIElement } from "../types.js";

export type FindStrategy = "label" | "type" | "value" | "fuzzy";

export interface FindResult {
  found: boolean;
  element?: UIElement;
  confidence?: number; // 0–1, 1 = exact match
  suggestion?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** 0–1 confidence from Levenshtein distance vs max possible distance */
function levenshteinConfidence(a: string, b: string): number {
  const d = distance(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - d / maxLen;
}

// ── Strategy implementations ──────────────────────────────────────────────────

function byLabel(
  elements: UIElement[],
  query: string
): FindResult {
  const q = normalize(query);
  const exact = elements.find((e) => normalize(e.label) === q);
  if (exact) return { found: true, element: exact, confidence: 1 };

  // Case-insensitive substring
  const sub = elements.find((e) => normalize(e.label).includes(q));
  if (sub) return { found: true, element: sub, confidence: 0.8 };

  return {
    found: false,
    suggestion: "Try strategy='fuzzy' or take_screenshot to see current state",
  };
}

function byType(
  elements: UIElement[],
  query: string
): FindResult {
  const q = normalize(query);
  const match = elements.find((e) => normalize(e.type) === q);
  if (match) return { found: true, element: match, confidence: 1 };

  const sub = elements.find((e) => normalize(e.type).includes(q));
  if (sub) return { found: true, element: sub, confidence: 0.8 };

  return {
    found: false,
    suggestion: "Try take_screenshot to see current state",
  };
}

function byValue(
  elements: UIElement[],
  query: string
): FindResult {
  const q = normalize(query);
  const exact = elements.find(
    (e) => e.value !== undefined && normalize(e.value) === q
  );
  if (exact) return { found: true, element: exact, confidence: 1 };

  const sub = elements.find(
    (e) => e.value !== undefined && normalize(e.value).includes(q)
  );
  if (sub) return { found: true, element: sub, confidence: 0.8 };

  return {
    found: false,
    suggestion: "Try strategy='label' or take_screenshot to see current state",
  };
}

function fuzzy(
  elements: UIElement[],
  query: string
): FindResult {
  const q = normalize(query);

  let bestElement: UIElement | undefined;
  let bestScore = -1;

  for (const el of elements) {
    const candidates = [
      normalize(el.label),
      el.value !== undefined ? normalize(el.value) : "",
    ].filter(Boolean);

    for (const candidate of candidates) {
      // Exact match
      if (candidate === q) {
        return { found: true, element: el, confidence: 1 };
      }

      // Substring boost
      let score: number;
      if (candidate.includes(q) || q.includes(candidate)) {
        score = 0.85;
      } else {
        score = levenshteinConfidence(q, candidate);
      }

      if (score > bestScore) {
        bestScore = score;
        bestElement = el;
      }
    }
  }

  // Require at least 50% confidence to be considered a match
  const CONFIDENCE_THRESHOLD = 0.5;
  if (bestElement && bestScore >= CONFIDENCE_THRESHOLD) {
    return { found: true, element: bestElement, confidence: bestScore };
  }

  return {
    found: false,
    suggestion: "Try take_screenshot to see current state",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function findElement(
  elements: UIElement[],
  query: string,
  strategy: FindStrategy = "fuzzy"
): FindResult {
  switch (strategy) {
    case "label":
      return byLabel(elements, query);
    case "type":
      return byType(elements, query);
    case "value":
      return byValue(elements, query);
    case "fuzzy":
      return fuzzy(elements, query);
  }
}

/** Returns only interactive elements (buttons, inputs, links, switches, etc.) */
export function filterInteractive(elements: UIElement[]): UIElement[] {
  const INTERACTIVE_TYPES = new Set([
    "button",
    "textfield",
    "securetextfield",
    "searchfield",
    "link",
    "switch",
    "slider",
    "stepper",
    "segmentedcontrol",
    "datepicker",
    "picker",
    "pickerwheel",
    "menuitem",
    "tab",
    "cell",
    "toggle",
    "checkbox",
    "radiobutton",
    "combobox",
  ]);

  return elements.filter(
    (e) =>
      e.enabled &&
      e.visible &&
      INTERACTIVE_TYPES.has(e.type.toLowerCase())
  );
}

/** Returns all visible static text elements, deduped. */
export function extractVisibleText(elements: UIElement[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const el of elements) {
    if (!el.visible) continue;
    const texts = [el.label, el.value].filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0
    );
    for (const t of texts) {
      if (!seen.has(t)) {
        seen.add(t);
        result.push(t);
      }
    }
  }

  return result;
}
