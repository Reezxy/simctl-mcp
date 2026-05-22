import { exec, execOrThrow, isExecError } from "../utils/exec.js";
import { toolError, toolOk } from "../types.js";
// ── Helpers ───────────────────────────────────────────────────────────────────
function runtimeKeyToOs(key) {
    // "com.apple.CoreSimulator.SimRuntime.iOS-17-2" → "iOS 17.2"
    // "com.apple.CoreSimulator.SimRuntime.watchOS-10-0" → "watchOS 10.0"
    const match = key.match(/SimRuntime\.([A-Za-z]+)-(\d+)-(\d+)/);
    if (!match)
        return key;
    const [, platform, major, minor] = match;
    return `${platform} ${major}.${minor}`;
}
async function getBootedUdid() {
    const result = await exec("xcrun simctl list devices booted --json", {
        timeoutMs: 10_000,
    });
    if (isExecError(result))
        return null;
    try {
        const parsed = JSON.parse(result.stdout);
        for (const devices of Object.values(parsed.devices)) {
            for (const d of devices) {
                if (d.state === "Booted")
                    return d.udid;
            }
        }
    }
    catch {
        // ignore parse errors
    }
    return null;
}
// ── Core logic (exported for tests) ──────────────────────────────────────────
export async function listSimulators() {
    const result = await execOrThrow("xcrun simctl list devices --json", {
        timeoutMs: 15_000,
    });
    const parsed = JSON.parse(result.stdout);
    const simulators = [];
    for (const [runtimeKey, devices] of Object.entries(parsed.devices)) {
        const os = runtimeKeyToOs(runtimeKey);
        for (const d of devices) {
            simulators.push({
                udid: d.udid,
                name: d.name,
                os,
                state: d.state,
                isAvailable: d.isAvailable,
            });
        }
    }
    return simulators;
}
export async function getBootedSimulator() {
    const result = await exec("xcrun simctl list devices booted --json", {
        timeoutMs: 10_000,
    });
    if (isExecError(result))
        return null;
    try {
        const parsed = JSON.parse(result.stdout);
        for (const [runtimeKey, devices] of Object.entries(parsed.devices)) {
            for (const d of devices) {
                if (d.state === "Booted") {
                    return {
                        udid: d.udid,
                        name: d.name,
                        os: runtimeKeyToOs(runtimeKey),
                        state: d.state,
                        isAvailable: d.isAvailable,
                    };
                }
            }
        }
    }
    catch {
        // ignore parse errors
    }
    return null;
}
export async function installApp(appPath) {
    await execOrThrow(`xcrun simctl install booted "${appPath}"`, {
        timeoutMs: 60_000,
    });
}
export async function launchApp(bundleId, resetState = false) {
    if (resetState) {
        // Reset all privacy permissions
        await exec(`xcrun simctl privacy booted reset all "${bundleId}"`, { timeoutMs: 10_000 });
        // Delete the app's UserDefaults plist
        const udid = await getBootedUdid();
        if (udid) {
            const containerResult = await exec(`xcrun simctl get_app_container booted "${bundleId}" data`, { timeoutMs: 10_000 });
            if (!isExecError(containerResult)) {
                const dataContainer = containerResult.stdout.trim();
                await exec(`rm -f "${dataContainer}/Library/Preferences/${bundleId}.plist"`, { timeoutMs: 5_000 });
            }
        }
    }
    const result = await execOrThrow(`xcrun simctl launch booted "${bundleId}"`, { timeoutMs: 15_000 });
    // Output is: "<bundle_id>: <pid>"
    return result.stdout.trim();
}
export async function terminateApp(bundleId) {
    await execOrThrow(`xcrun simctl terminate booted "${bundleId}"`, {
        timeoutMs: 10_000,
    });
}
export async function getAppInfo(bundleId) {
    // Get the .app bundle path inside the simulator
    const containerResult = await execOrThrow(`xcrun simctl get_app_container booted "${bundleId}" app`, { timeoutMs: 10_000 });
    const appPath = containerResult.stdout.trim();
    // Read Info.plist as JSON
    const plistResult = await execOrThrow(`plutil -convert json -o - "${appPath}/Info.plist"`, { timeoutMs: 10_000 });
    const plist = JSON.parse(plistResult.stdout);
    // Read entitlements (best-effort, may not exist for all apps)
    let entitlements = null;
    const entResult = await exec(`codesign -d --entitlements :- --xml "${appPath}" 2>/dev/null | plutil -convert json -o - -`, { timeoutMs: 10_000 });
    if (!isExecError(entResult) && entResult.stdout.trim().startsWith("{")) {
        try {
            entitlements = JSON.parse(entResult.stdout);
        }
        catch {
            // non-critical
        }
    }
    return {
        bundleId: plist.CFBundleIdentifier ?? bundleId,
        displayName: plist.CFBundleDisplayName ?? plist.CFBundleName ?? bundleId,
        version: plist.CFBundleShortVersionString ?? "unknown",
        buildNumber: plist.CFBundleVersion ?? "unknown",
        minimumOS: plist.MinimumOSVersion ?? "unknown",
        entitlements,
    };
}
// ── MCP tool definitions ──────────────────────────────────────────────────────
export const simulatorTools = [
    {
        name: "list_simulators",
        description: "Returns all available iOS/watchOS/tvOS simulators with their UDID, name, OS version, and current state (Booted/Shutdown).",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
            try {
                const sims = await listSimulators();
                return toolOk(sims);
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "get_booted_simulator",
        description: "Returns the UDID and metadata of the currently booted simulator. Returns an error if no simulator is booted.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
            try {
                const sim = await getBootedSimulator();
                if (!sim) {
                    return toolError("No simulator is currently booted. Boot one in Xcode or run: xcrun simctl boot <udid>");
                }
                return toolOk(sim);
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "install_app",
        description: "Installs a .app bundle to the currently booted simulator. Provide the absolute path to the .app directory.",
        inputSchema: {
            type: "object",
            properties: {
                app_path: {
                    type: "string",
                    description: "Absolute path to the .app bundle to install.",
                },
            },
            required: ["app_path"],
        },
        handler: async (args) => {
            const appPath = args["app_path"];
            try {
                await installApp(appPath);
                return toolOk({ success: true, message: `Installed ${appPath}` });
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "launch_app",
        description: "Launches an app on the booted simulator by bundle ID. Set reset_state=true to simulate a first-run experience (clears UserDefaults and resets permissions).",
        inputSchema: {
            type: "object",
            properties: {
                bundle_id: {
                    type: "string",
                    description: "The app's bundle identifier, e.g. com.example.myapp",
                },
                reset_state: {
                    type: "boolean",
                    description: "If true, clears UserDefaults and resets all privacy permissions before launching.",
                },
            },
            required: ["bundle_id"],
        },
        handler: async (args) => {
            const bundleId = args["bundle_id"];
            const resetState = args["reset_state"] ?? false;
            try {
                const output = await launchApp(bundleId, resetState);
                return toolOk({ success: true, output, reset_state: resetState });
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "terminate_app",
        description: "Terminates a running app on the booted simulator.",
        inputSchema: {
            type: "object",
            properties: {
                bundle_id: {
                    type: "string",
                    description: "The app's bundle identifier.",
                },
            },
            required: ["bundle_id"],
        },
        handler: async (args) => {
            const bundleId = args["bundle_id"];
            try {
                await terminateApp(bundleId);
                return toolOk({ success: true, message: `Terminated ${bundleId}` });
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
    {
        name: "get_app_info",
        description: "Returns version, build number, minimum OS, and entitlements for an installed app bundle.",
        inputSchema: {
            type: "object",
            properties: {
                bundle_id: {
                    type: "string",
                    description: "The app's bundle identifier.",
                },
            },
            required: ["bundle_id"],
        },
        handler: async (args) => {
            const bundleId = args["bundle_id"];
            try {
                const info = await getAppInfo(bundleId);
                return toolOk(info);
            }
            catch (err) {
                return toolError(err.message);
            }
        },
    },
];
//# sourceMappingURL=simulator.js.map