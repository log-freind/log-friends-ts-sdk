import type { BatchTransport, LogFriendsEvent } from "./types.js";

export class FetchBatchTransport implements BatchTransport {
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(
    private readonly endpoint: string,
    fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  ) {
    if (!/^https?:\/\//u.test(endpoint)) {
      throw new Error("Log Friends endpoint must be an absolute HTTP(S) URL.");
    }
    if (typeof fetchImplementation !== "function") {
      throw new Error("A fetch implementation is required when an endpoint is configured.");
    }
    this.fetchImplementation = fetchImplementation;
  }

  async send(events: readonly LogFriendsEvent[]): Promise<void> {
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error(`Log Friends ingest failed with status ${String(response.status)}.`);
    }
  }
}
