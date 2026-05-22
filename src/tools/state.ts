import {
  registerScreen,
  markScreenTested,
  addEdge,
  addBug,
  getGraph,
  getBugs,
  getStats,
  hasVisitedTooManyTimes,
  resetGraph,
} from "../engine/screen-graph.js";
import { generateReport } from "../engine/report-generator.js";
import { toolError, toolOk } from "../types.js";
import type { Bug, McpToolDef, TestResult } from "../types.js";

export const stateTools: McpToolDef[] = [
  {
    name: "register_screen",
    description:
      "Registers the current screen in the test session's screen graph. " +
      "Call this every time you identify a new or revisited screen. " +
      "Returns the node with its current visit count. " +
      "The graph tracks coverage and prevents infinite navigation loops.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Short, unique screen identifier, e.g. 'HomeScreen', 'CheckoutForm'.",
        },
        description: {
          type: "string",
          description: "Optional human-readable description of the screen.",
        },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const name = args["name"] as string;
      const description = args["description"] as string | undefined;
      const node = registerScreen(name, description);
      return toolOk({
        ...node,
        alreadyVisited: node.visitCount > 1,
        tooManyVisits: hasVisitedTooManyTimes(name),
      });
    },
  },

  {
    name: "mark_screen_tested",
    description:
      "Records the test outcome for a screen. " +
      "Results: 'pass' (all interactions worked), 'fail' (bug found), " +
      "'skip' (deliberately skipped), 'blocked' (could not interact). " +
      "Add notes to explain failures or skip reasons.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Screen name as registered with register_screen.",
        },
        result: {
          type: "string",
          enum: ["pass", "fail", "skip", "blocked"],
          description: "Test outcome.",
        },
        notes: {
          type: "string",
          description: "Optional notes — why it failed, what was skipped, etc.",
        },
      },
      required: ["name", "result"],
    },
    handler: async (args) => {
      const name = args["name"] as string;
      const result = args["result"] as TestResult;
      const notes = args["notes"] as string | undefined;
      const node = markScreenTested(name, result, notes);
      return toolOk(node);
    },
  },

  {
    name: "add_navigation_edge",
    description:
      "Records a navigation transition in the screen graph: which screen you came from, " +
      "which screen you arrived at, and what action caused the transition. " +
      "Call this after every successful navigation so the graph stays accurate.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source screen name." },
        to: { type: "string", description: "Destination screen name." },
        action: {
          type: "string",
          description:
            "What triggered the navigation, e.g. 'tap Sign In', 'swipe back'.",
        },
      },
      required: ["from", "to", "action"],
    },
    handler: async (args) => {
      const from = args["from"] as string;
      const to = args["to"] as string;
      const action = args["action"] as string;
      addEdge(from, to, action);
      return toolOk({ recorded: true, from, to, action });
    },
  },

  {
    name: "get_screen_graph",
    description:
      "Returns the full directed graph of discovered screens and navigation paths. " +
      "Each node includes name, visit count, test result, and discovery time. " +
      "Each edge includes from/to screens and the action that triggered navigation. " +
      "Use this to understand coverage and plan which screens still need testing.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const graph = getGraph();
      const stats = getStats();
      return toolOk({ ...graph, stats });
    },
  },

  {
    name: "add_bug",
    description:
      "Records a bug found during testing. Call this whenever you observe unexpected behaviour: " +
      "crashes, error messages, broken interactions, blank screens, missing feedback. " +
      "Severities: critical (crash/data loss), high (broken feature), " +
      "medium (degraded UX), low (cosmetic/minor). " +
      "Returns the assigned bug ID.",
    inputSchema: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Bug severity level.",
        },
        title: {
          type: "string",
          description: "Short one-line bug title.",
        },
        description: {
          type: "string",
          description:
            "Steps to reproduce and what was expected vs actual.",
        },
        screen: {
          type: "string",
          description: "Screen name where the bug was observed.",
        },
        screenshot_path: {
          type: "string",
          description: "Path to a screenshot of the bug (optional).",
        },
        log_excerpt: {
          type: "string",
          description: "Relevant console log lines (optional).",
        },
      },
      required: ["severity", "title", "description", "screen"],
    },
    handler: async (args) => {
      const bug = addBug(
        args["severity"] as Bug["severity"],
        args["title"] as string,
        args["description"] as string,
        args["screen"] as string,
        args["screenshot_path"] as string | undefined,
        args["log_excerpt"] as string | undefined
      );
      return toolOk(bug);
    },
  },

  {
    name: "get_test_report",
    description:
      "Generates the final test report for the current session. " +
      "format='markdown' produces a human-readable report with a summary table, " +
      "screen coverage, bug list, and recommendations. " +
      "format='json' produces machine-readable output. " +
      "Call this at the end of a test session.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["markdown", "json"],
          description: "'markdown' for human-readable, 'json' for machine-readable.",
        },
        app_name: {
          type: "string",
          description: "App display name for the report header. Optional.",
        },
        app_version: {
          type: "string",
          description: "App version string for the report header. Optional.",
        },
      },
      required: ["format"],
    },
    handler: async (args) => {
      const format = args["format"] as "markdown" | "json";
      const appName = args["app_name"] as string | undefined;
      const appVersion = args["app_version"] as string | undefined;
      try {
        const report = await generateReport(format, appName, appVersion);
        return toolOk(report);
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "reset_test_session",
    description:
      "Clears all screen graph data, bugs, and stats to start a fresh test session. " +
      "Call this at the beginning of a new test run.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      resetGraph();
      return toolOk({ reset: true, message: "Test session cleared." });
    },
  },
];
