// Route matching and response building for the mock HTTP server.
/**
 * Normalises a route key like "GET /api/user" → { method: "GET", path: "/api/user" }.
 */
function parseRouteKey(key) {
    const parts = key.trim().split(/\s+/);
    if (parts.length < 2)
        return null;
    return { method: parts[0].toUpperCase(), path: parts.slice(1).join(" ") };
}
/**
 * Finds the best matching route for an incoming request.
 * Supports exact path match and simple prefix matching.
 * Returns the fallback "always 200" config if nothing matches.
 */
export function matchRoute(method, url, routes) {
    const upperMethod = method.toUpperCase();
    const pathname = url.split("?")[0] ?? url;
    // Exact match first
    for (const [key, config] of Object.entries(routes)) {
        const parsed = parseRouteKey(key);
        if (!parsed)
            continue;
        if (parsed.method === upperMethod && parsed.path === pathname) {
            return { config, matched: true };
        }
    }
    // Prefix match (allows route "/api/user" to match "/api/user/123")
    for (const [key, config] of Object.entries(routes)) {
        const parsed = parseRouteKey(key);
        if (!parsed)
            continue;
        if (parsed.method === upperMethod &&
            pathname.startsWith(parsed.path)) {
            return { config, matched: true };
        }
    }
    // Default: 200 with empty body
    return { config: { status: 200, body: {} }, matched: false };
}
/**
 * Applies an optional delay from the route config before the caller sends a response.
 */
export async function applyDelay(config) {
    if (config.delay_ms && config.delay_ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.delay_ms));
    }
}
//# sourceMappingURL=routes.js.map