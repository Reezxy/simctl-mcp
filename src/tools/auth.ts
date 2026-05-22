import { exec, execOrThrow, isExecError } from "../utils/exec.js";
import { getBackend } from "../utils/idb-check.js";
import { toolError, toolOk } from "../types.js";
import type { McpToolDef } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

type PlistValue = string | number | boolean;

function plistTypeFlag(value: PlistValue): { flag: string; str: string } {
  if (typeof value === "boolean") {
    return { flag: "-bool", str: value ? "YES" : "NO" };
  }
  if (typeof value === "number") {
    return {
      flag: Number.isInteger(value) ? "-integer" : "-float",
      str: String(value),
    };
  }
  return { flag: "-string", str: value };
}

// ── Core logic ────────────────────────────────────────────────────────────────

export async function injectUserDefaults(
  bundleId: string,
  key: string,
  value: PlistValue
): Promise<void> {
  const { flag, str } = plistTypeFlag(value);
  await execOrThrow(
    `xcrun simctl spawn booted defaults write "${bundleId}" "${key}" ${flag} "${str}"`,
    { timeoutMs: 10_000 }
  );
}

export async function readUserDefaults(
  bundleId: string,
  key: string
): Promise<string | null> {
  const result = await exec(
    `xcrun simctl spawn booted defaults read "${bundleId}" "${key}"`,
    { timeoutMs: 10_000 }
  );
  if (isExecError(result)) return null;
  return result.stdout.trim() || null;
}

export async function setKeychainValue(
  account: string,
  service: string,
  value: string
): Promise<void> {
  const backend = await getBackend();
  if (backend.backend !== "idb") {
    throw new Error(
      "Keychain injection requires idb. Install idb (pip3 install fb-idb)."
    );
  }
  await execOrThrow(
    `${backend.idbPath} keychain add --account "${account}" --service "${service}" --value "${value}"`,
    { timeoutMs: 10_000 }
  );
}

export async function resetAppState(bundleId: string): Promise<string[]> {
  const steps: string[] = [];

  // 1. Terminate
  const termResult = await exec(
    `xcrun simctl terminate booted "${bundleId}"`,
    { timeoutMs: 10_000 }
  );
  steps.push(
    isExecError(termResult)
      ? `terminate: skipped (${termResult.message})`
      : "terminate: ok"
  );

  // 2. Clear data container (Library, Documents, tmp)
  const containerResult = await exec(
    `xcrun simctl get_app_container booted "${bundleId}" data`,
    { timeoutMs: 10_000 }
  );
  if (!isExecError(containerResult)) {
    const container = containerResult.stdout.trim();
    for (const dir of ["Library", "Documents", "tmp"]) {
      const rm = await exec(`rm -rf "${container}/${dir}"`, {
        timeoutMs: 15_000,
      });
      steps.push(
        isExecError(rm) ? `clear ${dir}: failed` : `clear ${dir}: ok`
      );
    }
  } else {
    steps.push(`get_app_container: skipped (${containerResult.message})`);
  }

  // 3. Reset all permissions
  const privResult = await exec(
    `xcrun simctl privacy booted reset all "${bundleId}"`,
    { timeoutMs: 10_000 }
  );
  steps.push(
    isExecError(privResult)
      ? `reset permissions: failed (${privResult.message})`
      : "reset permissions: ok"
  );

  // 4. Clear keychain — idb only, best-effort
  const backend = await getBackend().catch(() => null);
  if (backend?.backend === "idb" && backend.idbPath) {
    const kc = await exec(`${backend.idbPath} keychain clear`, {
      timeoutMs: 10_000,
    });
    steps.push(isExecError(kc) ? "clear keychain: failed" : "clear keychain: ok");
  } else {
    steps.push("clear keychain: skipped (idb not available)");
  }

  return steps;
}

export async function setLocation(
  latitude: number,
  longitude: number
): Promise<void> {
  await execOrThrow(
    `xcrun simctl location booted set ${latitude} ${longitude}`,
    { timeoutMs: 10_000 }
  );
}

export type PermissionValue = "grant" | "revoke" | "unset";

export async function setPermissions(
  bundleId: string,
  permission: string,
  value: PermissionValue
): Promise<void> {
  await execOrThrow(
    `xcrun simctl privacy booted ${value} ${permission} "${bundleId}"`,
    { timeoutMs: 10_000 }
  );
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const authTools: McpToolDef[] = [
  {
    name: "inject_user_defaults",
    description:
      "Writes a value to the app's NSUserDefaults (plist preferences). " +
      "Use to skip onboarding, enable feature flags, or inject mock user data before launching. " +
      "Supports string, integer, float, and boolean values.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "App bundle identifier." },
        key: { type: "string", description: "UserDefaults key to write." },
        value: {
          description: "Value to write (string, number, or boolean).",
        },
      },
      required: ["bundle_id", "key", "value"],
    },
    handler: async (args) => {
      const bundleId = args["bundle_id"] as string;
      const key = args["key"] as string;
      const value = args["value"] as PlistValue;
      try {
        await injectUserDefaults(bundleId, key, value);
        return toolOk({ success: true, bundle_id: bundleId, key, value });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "read_user_defaults",
    description:
      "Reads a value from the app's NSUserDefaults. " +
      "Use to assert that the app persisted state correctly after an action.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "App bundle identifier." },
        key: { type: "string", description: "UserDefaults key to read." },
      },
      required: ["bundle_id", "key"],
    },
    handler: async (args) => {
      const bundleId = args["bundle_id"] as string;
      const key = args["key"] as string;
      try {
        const value = await readUserDefaults(bundleId, key);
        return toolOk({ key, value, found: value !== null });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "set_keychain_value",
    description:
      "Injects a keychain entry so the app can start in a logged-in state. " +
      "Requires idb. Use account + service to match the app's SecItem query.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "kSecAttrAccount value." },
        service: { type: "string", description: "kSecAttrService value." },
        value: { type: "string", description: "Secret value to store." },
      },
      required: ["account", "service", "value"],
    },
    handler: async (args) => {
      const account = args["account"] as string;
      const service = args["service"] as string;
      const value = args["value"] as string;
      try {
        await setKeychainValue(account, service, value);
        return toolOk({ success: true, account, service });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "reset_app_state",
    description:
      "Full app state reset: terminates the app, clears the data container " +
      "(Library, Documents, tmp), resets all permissions, and clears the keychain (idb). " +
      "Equivalent to reinstalling. Call this before testing first-run or onboarding flows. " +
      "Returns a step-by-step log of what was cleared.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "App bundle identifier." },
      },
      required: ["bundle_id"],
    },
    handler: async (args) => {
      const bundleId = args["bundle_id"] as string;
      try {
        const steps = await resetAppState(bundleId);
        return toolOk({ bundle_id: bundleId, steps });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "set_location",
    description:
      "Sets the simulated GPS location for the booted simulator. " +
      "Useful for testing location-based features without moving physically.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number", description: "Latitude in decimal degrees." },
        longitude: { type: "number", description: "Longitude in decimal degrees." },
      },
      required: ["latitude", "longitude"],
    },
    handler: async (args) => {
      const lat = args["latitude"] as number;
      const lon = args["longitude"] as number;
      try {
        await setLocation(lat, lon);
        return toolOk({ success: true, latitude: lat, longitude: lon });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },

  {
    name: "set_permissions",
    description:
      "Grants, revokes, or resets a specific app permission. " +
      "Permissions: camera, microphone, photos, location, contacts, " +
      "reminders, calendars, motion, health, notifications, bluetooth, all. " +
      "Values: 'grant', 'revoke', 'unset'.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "App bundle identifier." },
        permission: {
          type: "string",
          description: "Permission name (e.g. 'camera', 'location', 'all').",
        },
        value: {
          type: "string",
          enum: ["grant", "revoke", "unset"],
          description: "Action to take on the permission.",
        },
      },
      required: ["bundle_id", "permission", "value"],
    },
    handler: async (args) => {
      const bundleId = args["bundle_id"] as string;
      const permission = args["permission"] as string;
      const value = args["value"] as PermissionValue;
      try {
        await setPermissions(bundleId, permission, value);
        return toolOk({ success: true, bundle_id: bundleId, permission, value });
      } catch (err) {
        return toolError((err as Error).message);
      }
    },
  },
];
