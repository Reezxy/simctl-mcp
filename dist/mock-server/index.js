import express from "express";
import { createServer } from "http";
import { mockServerState } from "./state.js";
import { matchRoute, applyDelay } from "./routes.js";
let requestCounter = 0;
/**
 * Starts the Express mock server.
 * Registers all configured routes, catches all unmatched requests with 200 + {},
 * and exposes GET /mock/calls to inspect recorded traffic.
 */
async function startServer(port, routesConfig = {}) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    // Introspection endpoint — must come before the catch-all
    app.get("/mock/calls", (_req, res) => {
        res.json({ count: mockServerState.requests.length, calls: mockServerState.requests });
    });
    app.delete("/mock/calls", (_req, res) => {
        mockServerState.requests.length = 0;
        requestCounter = 0;
        res.json({ cleared: true });
    });
    // Catch-all handler
    app.use(async (req, res) => {
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
            body: req.body,
            responseStatus: status,
        });
        if (!matched && process.env["NODE_ENV"] !== "test") {
            console.warn(`[mock-server] Unmatched route ${req.method} ${req.url} → 200 {}`);
        }
        res.status(status).json(body);
    });
    return new Promise((resolve, reject) => {
        const server = createServer(app);
        server.on("error", reject);
        server.listen(port, "127.0.0.1", () => {
            mockServerState.running = true;
            mockServerState.port = port;
            mockServerState.requests = [];
            requestCounter = 0;
            mockServerState.stop = async () => {
                await new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())));
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
globalThis["__mockServerStart__"] =
    startServer;
export { startServer };
//# sourceMappingURL=index.js.map