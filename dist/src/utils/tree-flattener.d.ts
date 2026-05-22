import type { UIElement } from "../types.js";
export interface IdbRawNode {
    type?: string;
    label?: string;
    value?: string | number | boolean | null;
    frame?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        origin?: {
            x?: number;
            y?: number;
        };
        size?: {
            width?: number;
            height?: number;
        };
    };
    enabled?: boolean;
    visible?: boolean;
    children?: IdbRawNode[];
}
export interface FlattenResult {
    elements: UIElement[];
    truncated: boolean;
    totalCount: number;
}
/**
 * Flattens a nested idb accessibility tree into a flat UIElement array.
 * Caps at 500 elements and sets `truncated: true` if the tree was larger.
 */
export declare function flattenTree(root: IdbRawNode): FlattenResult;
/**
 * Parses the raw string output of `idb ui describe-all`.
 * idb emits either a single JSON object or a JSON array with one root element.
 */
export declare function parseIdbOutput(raw: string): FlattenResult;
//# sourceMappingURL=tree-flattener.d.ts.map