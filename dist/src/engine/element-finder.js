import { distance } from "fastest-levenshtein";
// ── Helpers ───────────────────────────────────────────────────────────────────
function normalize(s) {
    return s.toLowerCase().trim();
}
/** 0–1 confidence from Levenshtein distance vs max possible distance */
function levenshteinConfidence(a, b) {
    const d = distance(a, b);
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0)
        return 1;
    return 1 - d / maxLen;
}
// ── Strategy implementations ──────────────────────────────────────────────────
function byLabel(elements, query) {
    const q = normalize(query);
    const exact = elements.find((e) => normalize(e.label) === q);
    if (exact)
        return { found: true, element: exact, confidence: 1 };
    // Case-insensitive substring
    const sub = elements.find((e) => normalize(e.label).includes(q));
    if (sub)
        return { found: true, element: sub, confidence: 0.8 };
    return {
        found: false,
        suggestion: "Try strategy='fuzzy' or take_screenshot to see current state",
    };
}
function byType(elements, query) {
    const q = normalize(query);
    const match = elements.find((e) => normalize(e.type) === q);
    if (match)
        return { found: true, element: match, confidence: 1 };
    const sub = elements.find((e) => normalize(e.type).includes(q));
    if (sub)
        return { found: true, element: sub, confidence: 0.8 };
    return {
        found: false,
        suggestion: "Try take_screenshot to see current state",
    };
}
function byValue(elements, query) {
    const q = normalize(query);
    const exact = elements.find((e) => e.value !== undefined && normalize(e.value) === q);
    if (exact)
        return { found: true, element: exact, confidence: 1 };
    const sub = elements.find((e) => e.value !== undefined && normalize(e.value).includes(q));
    if (sub)
        return { found: true, element: sub, confidence: 0.8 };
    return {
        found: false,
        suggestion: "Try strategy='label' or take_screenshot to see current state",
    };
}
function fuzzy(elements, query) {
    const q = normalize(query);
    let bestElement;
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
            let score;
            if (candidate.includes(q) || q.includes(candidate)) {
                score = 0.85;
            }
            else {
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
export function findElement(elements, query, strategy = "fuzzy") {
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
export function filterInteractive(elements) {
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
    return elements.filter((e) => e.enabled &&
        e.visible &&
        INTERACTIVE_TYPES.has(e.type.toLowerCase()));
}
/** Returns all visible static text elements, deduped. */
export function extractVisibleText(elements) {
    const seen = new Set();
    const result = [];
    for (const el of elements) {
        if (!el.visible)
            continue;
        const texts = [el.label, el.value].filter((t) => typeof t === "string" && t.trim().length > 0);
        for (const t of texts) {
            if (!seen.has(t)) {
                seen.add(t);
                result.push(t);
            }
        }
    }
    return result;
}
//# sourceMappingURL=element-finder.js.map