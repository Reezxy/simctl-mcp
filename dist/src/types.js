// ── Simulator ─────────────────────────────────────────────────────────────────
// ── Generic tool error helper ─────────────────────────────────────────────────
export function toolError(message) {
    return {
        content: [{ type: "text", text: JSON.stringify({ error: true, message }) }],
        isError: true,
    };
}
export function toolOk(data) {
    return {
        content: [
            {
                type: "text",
                text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
        ],
    };
}
//# sourceMappingURL=types.js.map