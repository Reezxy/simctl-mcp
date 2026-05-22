// Shared in-process state for the mock HTTP server.
// Populated by mock-server/index.ts in step 11.

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

export const mockServerState: MockServerState = {
  running: false,
  port: null,
  requests: [],
  stop: null,
};
