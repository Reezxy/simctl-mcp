import { exec, isExecError } from "../utils/exec.js";
import { getBackend, idbCmd } from "../utils/idb-check.js";
import { parseIdbOutput } from "../utils/tree-flattener.js";
import {
  findElement,
  filterInteractive,
  extractVisibleText,
} from "../engine/element-finder.js";
import { toolError, toolOk } from "../types.js";
import type {
  McpToolDef,
  ScreenDescription,
  ScreenType,
  UIElement,
} from "../types.js";
import type { FindStrategy } from "../engine/element-finder.js";

// ── Screen type detection ─────────────────────────────────────────────────────

const AUTH_KEYWORDS = ["sign in", "log in", "login", "password", "email", "username", "create account", "sign up", "forgot password"];
const ONBOARDING_KEYWORDS = ["get started", "continue", "next", "welcome", "skip", "allow", "enable"];
const DESTRUCTIVE_KEYWORDS = ["delete", "remove", "cancel", "log out", "sign out", "deactivate"];

function detectScreenType(elements: UIElement[]): ScreenType {
  const allText = elements
    .flatMap((e) => [e.label, e.value ?? ""])
    .join(" ")
    .toLowerCase();

  const types = elements.map((e) => e.type.toLowerCase());

  // Modal / alert / sheet
  if (types.some((t) => ["sheet", "alert", "dialog", "popover"].includes(t))) {
    return "modal";
  }

  // Auth
  if (
    AUTH_KEYWORDS.some((k) => allText.includes(k)) &&
    types.some((t) => ["securetextfield", "textfield"].includes(t))
  ) {
    return "auth";
  }

  // Tab bar present
  if (types.includes("tabbar") || types.includes("tab")) {
    return "tab-bar";
  }

  // Form: 2+ text fields
  const fieldCount = types.filter((t) =>
    ["textfield", "securetextfield", "searchfield"].includes(t)
  ).length;
  if (fieldCount >= 2) return "form";

  // List: many cells / rows
  const cellCount = types.filter((t) =>
    ["cell", "row", "staticcell"].includes(t)
  ).length;
  if (cellCount >= 3) return "list";

  // Onboarding
  if (ONBOARDING_KEYWORDS.some((k) => allText.includes(k))) {
    return "onboarding";
  }

  // Single cell group or detail-like layout
  if (cellCount > 0) return "detail";

  return "unknown";
}

function suggestActions(
  screenType: ScreenType,
  interactive: UIElement[]
): string[] {
  const labels = interactive.map((e) => `"${e.label}"`).join(", ");

  switch (screenType) {
    case "auth":
      return [
        "Use inject_user_defaults or set_keychain_value to pre-seed credentials",
        "Fill email/username field with test@example.com",
        "Fill password field with TestPass123!",
        "Tap Sign In / Log In button",
      ];
    case "onboarding":
      return [
        "Tap Continue / Next / Get Started to advance",
        "Use inject_user_defaults to skip onboarding if available",
        `Interactive elements: ${labels}`,
      ];
    case "form":
      return [
        "Fill all required fields before submitting",
        "Use input_text after tapping each field",
        "assert_element_enabled on submit button before tapping",
        `Fields/buttons: ${labels}`,
      ];
    case "list":
      return [
        "Use scroll_to_element to find items not currently visible",
        "Tap a cell to navigate to detail view",
        "Check for empty state if no cells are visible",
      ];
    case "tab-bar":
      return [
        "Test each tab systematically before exploring nested screens",
        `Tabs: ${labels}`,
      ];
    case "modal":
      return [
        "Test the modal content, then dismiss it",
        "Check for dismiss / cancel / close button",
        `Modal actions: ${labels}`,
      ];
    case "detail":
      return [
        "Read content, then interact with any action buttons",
        "Check for edit / share / delete actions",
        `Actions: ${labels}`,
      ];
    default:
      return [
        "Call get_accessibility_tree for full element list",
        "Use find_element to locate specific controls",
        `Visible interactive: ${labels || "none"}`,
      ];
  }
}

// ── Core logic (exported for tests) ──────────────────────────────────────────

export async function getAccessibilityTree(): Promise<{
  elements: UIElement[];
  truncated: boolean;
  totalCount: number;
}> {
  const backend = await getBackend();

  if (backend.backend === "idb") {
    const cmd = await idbCmd("ui describe-all");
    const result = await exec(cmd, { timeoutMs: 15_000 });

    if (isExecError(result)) {
      throw new Error(
        `idb accessibility tree failed: ${result.message}. ` +
          "Try take_screenshot to see current state."
      );
    }

    return parseIdbOutput(result.stdout);
  }

  // xcrun fallback — no direct accessibility tree support
  throw new Error(
    "Accessibility tree requires idb. " +
      "Install idb (pip3 install fb-idb) or use take_screenshot as a fallback."
  );
}

export async function describeCurrentScreen(): Promise<ScreenDescription> {
  const { elements } = await getAccessibilityTree();

  // Navigation bar title is typically a StaticText inside a NavigationBar
  let title: string | null = null;
  const navBarIdx = elements.findIndex(
    (e) => e.type.toLowerCase() === "navigationbar"
  );
  if (navBarIdx !== -1) {
    // First StaticText child of the nav bar
    const navBarDepth = elements[navBarIdx].depth;
    for (let i = navBarIdx + 1; i < elements.length; i++) {
      if (elements[i].depth <= navBarDepth) break;
      if (elements[i].type.toLowerCase() === "statictext" && elements[i].label) {
        title = elements[i].label;
        break;
      }
    }
  }

  const interactive = filterInteractive(elements);
  const visibleText = extractVisibleText(elements);
  const screenType = detectScreenType(elements);
  const suggestedActions = suggestActions(screenType, interactive);

  return { title, screenType, interactiveElements: interactive, visibleText, suggestedActions };
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const accessibilityTools: McpToolDef[] = [
  {
    name: "get_accessibility_tree",
    description:
      "Returns the full UI accessibility tree of the current screen as a flat array of elements. " +
      "Each element has label, type, value, frame (x/y/width/height), enabled, visible, depth, and parent info. " +
      "Max 500 elements returned; truncated flag is set if the tree is larger. " +
      "Prefer describe_current_screen for a cheaper overview first.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const result = await getAccessibilityTree();
        return toolOk(result);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "describe_current_screen",
    description:
      "High-level description of the current screen. Returns: screen title, detected screen type " +
      "(list/detail/form/modal/tab-bar/onboarding/auth/unknown), interactive elements only, " +
      "visible text content, and suggested next actions. " +
      "Call this first when arriving at any new screen — cheaper than get_accessibility_tree.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const desc = await describeCurrentScreen();
        return toolOk(desc);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "find_element",
    description:
      "Searches the accessibility tree for an element matching the query. " +
      "Strategies: 'label' (exact/substring on label), 'type' (element type like Button), " +
      "'value' (current value of inputs), 'fuzzy' (Levenshtein-tolerant, best for uncertain labels). " +
      "Returns best match and confidence score (0–1). Use fuzzy when label might differ slightly, " +
      "e.g. 'Sign In' vs 'Sign in'.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The label, type, or value to search for.",
        },
        strategy: {
          type: "string",
          enum: ["label", "type", "value", "fuzzy"],
          description: "Search strategy. Defaults to 'fuzzy'.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = args["query"] as string;
      const strategy = (args["strategy"] as FindStrategy | undefined) ?? "fuzzy";

      try {
        const { elements } = await getAccessibilityTree();
        const result = findElement(elements, query, strategy);
        return toolOk(result);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },
];
