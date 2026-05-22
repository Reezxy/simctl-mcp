import type { McpToolDef } from "../types.js";
type PlistValue = string | number | boolean;
export declare function injectUserDefaults(bundleId: string, key: string, value: PlistValue): Promise<void>;
export declare function readUserDefaults(bundleId: string, key: string): Promise<string | null>;
export declare function setKeychainValue(account: string, service: string, value: string): Promise<void>;
export declare function resetAppState(bundleId: string): Promise<string[]>;
export declare function setLocation(latitude: number, longitude: number): Promise<void>;
export type PermissionValue = "grant" | "revoke" | "unset";
export declare function setPermissions(bundleId: string, permission: string, value: PermissionValue): Promise<void>;
export declare const authTools: McpToolDef[];
export {};
//# sourceMappingURL=auth.d.ts.map