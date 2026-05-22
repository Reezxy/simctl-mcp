import type { RoutesMap } from "./routes.js";
/**
 * Starts the Express mock server.
 * Registers all configured routes, catches all unmatched requests with 200 + {},
 * and exposes GET /mock/calls to inspect recorded traffic.
 */
declare function startServer(port: number, routesConfig?: RoutesMap): Promise<void>;
export { startServer };
//# sourceMappingURL=index.d.ts.map