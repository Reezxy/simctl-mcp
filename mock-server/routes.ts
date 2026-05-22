// Route matching and response building for the mock HTTP server.

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
 * Normalises a route key like "GET /api/user" → { method: "GET", path: "/api/user" }.
 */
function parseRouteKey(key: string): { method: string; path: string } | null {
  const parts = key.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { method: parts[0]!.toUpperCase(), path: parts.slice(1).join(" ") };
}

/**
 * Finds the best matching route for an incoming request.
 * Supports exact path match and simple prefix matching.
 * Returns the fallback "always 200" config if nothing matches.
 */
export function matchRoute(
  method: string,
  url: string,
  routes: RoutesMap
): MatchedRoute {
  const upperMethod = method.toUpperCase();
  const pathname = url.split("?")[0] ?? url;

  // Exact match first
  for (const [key, config] of Object.entries(routes)) {
    const parsed = parseRouteKey(key);
    if (!parsed) continue;
    if (parsed.method === upperMethod && parsed.path === pathname) {
      return { config, matched: true };
    }
  }

  // Prefix match (allows route "/api/user" to match "/api/user/123")
  for (const [key, config] of Object.entries(routes)) {
    const parsed = parseRouteKey(key);
    if (!parsed) continue;
    if (
      parsed.method === upperMethod &&
      pathname.startsWith(parsed.path)
    ) {
      return { config, matched: true };
    }
  }

  // Default: 200 with empty body
  return { config: { status: 200, body: {} }, matched: false };
}

/**
 * Applies an optional delay from the route config before the caller sends a response.
 */
export async function applyDelay(config: RouteConfig): Promise<void> {
  if (config.delay_ms && config.delay_ms > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, config.delay_ms));
  }
}
