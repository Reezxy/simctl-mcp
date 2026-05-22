export declare const SCREENSHOTS_DIR = "./screenshots";
export interface ProcessedScreenshot {
    filePath: string;
    base64: string;
    width: number;
    height: number;
    fileSize: number;
    estimatedTokens: number;
    mimeType: "image/jpeg";
}
export interface DiffResult {
    matches: boolean;
    diffPercent: number;
    diffImagePath: string;
    totalPixels: number;
    diffPixels: number;
}
export interface ScreenshotStats {
    filePath: string;
    width: number;
    height: number;
    fileSize: number;
    estimatedTokens: number;
    mimeType: string;
}
/**
 * Resizes a raw PNG screenshot (from simctl/idb) to max 1024px wide,
 * converts to JPEG at 85% quality, saves to ./screenshots/, and returns
 * the processed result including base64 and token estimate.
 */
export declare function processScreenshot(sourcePngPath: string, screenName?: string): Promise<ProcessedScreenshot>;
/**
 * Pixel-by-pixel diff of two saved screenshot files.
 * Both images are resized to the same dimensions before comparison.
 * Diff pixels (channel delta ≥ 30) are highlighted red in the output image.
 */
export declare function diffScreenshots(baselinePath: string, comparePath: string, thresholdPercent?: number): Promise<DiffResult>;
/**
 * Returns dimensions, file size, and token estimate for an existing screenshot.
 */
export declare function getScreenshotStats(filePath: string): Promise<ScreenshotStats>;
//# sourceMappingURL=screenshot-processor.d.ts.map