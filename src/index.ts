import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { simulatorTools } from "./tools/simulator.js";
import { accessibilityTools } from "./tools/accessibility.js";
import { screenshotTools } from "./tools/screenshot.js";
import { interactionTools } from "./tools/interaction.js";
import { waitTools } from "./tools/wait.js";
import { assertionTools } from "./tools/assertions.js";
import { authTools } from "./tools/auth.js";
import { diagnosticTools } from "./tools/diagnostics.js";
import { stateTools } from "./tools/state.js";
import type { McpToolDef } from "./types.js";

// Register the mock server global so start_mock_server works.
// Side-effect import — sets globalThis.__mockServerStart__.
import "../mock-server/index.js";

const allTools: McpToolDef[] = [
  ...simulatorTools,
  ...accessibilityTools,
  ...screenshotTools,
  ...interactionTools,
  ...waitTools,
  ...assertionTools,
  ...authTools,
  ...diagnosticTools,
  ...stateTools,
];

const toolMap = new Map<string, McpToolDef>(
  allTools.map((t) => [t.name, t])
);

const server = new Server(
  { name: "ios-simulator-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name);

  if (!tool) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: true,
            message: `Unknown tool: ${request.params.name}`,
          }),
        },
      ],
      isError: true,
    };
  }

  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    const result = await tool.handler(args);
    return {
      content: result.content.map((c) => {
        if (c.type === "image") {
          return { type: "image" as const, data: c.data, mimeType: c.mimeType };
        }
        return { type: "text" as const, text: c.text };
      }),
      isError: result.isError,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: true, message }),
        },
      ],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
