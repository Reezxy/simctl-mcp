export interface RecordedRequest {
    id: string;
    timestamp: number;
    method: string;
    url: string;
    body: unknown;
    responseStatus: number;
}
export interface MockServerState {
    running: boolean;
    port: number | null;
    requests: RecordedRequest[];
    stop: (() => Promise<void>) | null;
}
export declare const mockServerState: MockServerState;
//# sourceMappingURL=state.d.ts.map