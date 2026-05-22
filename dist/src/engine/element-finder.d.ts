import type { UIElement } from "../types.js";
export type FindStrategy = "label" | "type" | "value" | "fuzzy";
export interface FindResult {
    found: boolean;
    element?: UIElement;
    confidence?: number;
    suggestion?: string;
}
export declare function findElement(elements: UIElement[], query: string, strategy?: FindStrategy): FindResult;
/** Returns only interactive elements (buttons, inputs, links, switches, etc.) */
export declare function filterInteractive(elements: UIElement[]): UIElement[];
/** Returns all visible static text elements, deduped. */
export declare function extractVisibleText(elements: UIElement[]): string[];
//# sourceMappingURL=element-finder.d.ts.map