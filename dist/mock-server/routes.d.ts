export interface RouteConfig {
    status?: number;
    body?: unknown;
    error?: string;
    delay_ms?: number;
}
export type RoutesMap = Record<string, RouteConfig>;
export interface MatchedRoute {
    config: RouteConfig;
    matched: boolean;
}
/**
 * Finds the best matching route for an incoming request.
 * Supports exact path match and simple prefix matching.
 * Returns the fallback "always 200" config if nothing matches.
 */
export declare function matchRoute(method: string, url: string, routes: RoutesMap): MatchedRoute;
/**
 * Applies an optional delay from the route config before the caller sends a response.
 */
export declare function applyDelay(config: RouteConfig): Promise<void>;
//# sourceMappingURL=routes.d.ts.map