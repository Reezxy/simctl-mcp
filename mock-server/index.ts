import express from "express";
import type { Request, Response } from "express";
import { createServer } from "http";
import type { Server } from "http";
import { mockServerState } from "./state.js";
import { matchRoute, applyDelay } from "./routes.js";
import type { RoutesMap } from "./routes.js";

let requestCounter = 0;

/**
 * Starts the Express mock server.
 * Registers all configured routes, catches all unmatched requests with 200 + {},
 * and exposes GET /mock/calls to inspect recorded traffic.
 */
async function startServer(
  port: number,
  routesConfig: RoutesMap = {}
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Introspection endpoint — must come before the catch-all
  app.get("/mock/calls", (_req: Request, res: Response) => {
    res.json({ count: mockServerState.requests.length, calls: mockServerState.requests });
  });

  app.delete("/mock/calls", (_req: Request, res: Response) => {
    mockServerState.requests.length = 0;
    requestCounter = 0;
    res.json({ cleared: true });
  });

  // Catch-all handler
  app.use(async (req: Request, res: Response) => {
    const { config, matched } = matchRoute(req.method, req.url, routesConfig);

    await applyDelay(config);

    const status = config.status ?? 200;
    const body = config.error
      ? { error: config.error }
      : (config.body ?? {});

    requestCounter++;
    mockServerState.requests.push({
      id: `req_${String(requestCounter).padStart(4, "0")}`,
      timestamp: Date.now(),
      method: req.method,
      url: req.url,
      body: req.body as unknown,
      responseStatus: status,
    });

    if (!matched && process.env["NODE_ENV"] !== "test") {
      console.warn(`[mock-server] Unmatched route ${req.method} ${req.url} → 200 {}`);
    }

    res.status(status).json(body);
  });

  return new Promise<void>((resolve, reject) => {
    const server: Server = createServer(app);

    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      mockServerState.running = true;
      mockServerState.port = port;
      mockServerState.requests = [];
      requestCounter = 0;

      mockServerState.stop = async () => {
        await new Promise<void>((res, rej) =>
          server.close((err) => (err ? rej(err) : res()))
        );
        mockServerState.running = false;
        mockServerState.port = null;
        mockServerState.stop = null;
      };

      resolve();
    });
  });
}

// Register the global hook so diagnostics.ts can call startServer
// without a circular import dependency.
(globalThis as unknown as Record<string, unknown>)["__mockServerStart__"] =
  startServer;

export { startServer };
