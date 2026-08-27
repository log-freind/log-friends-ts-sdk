import type { IngestRequest, IngestResponse, TransportSender } from "../core/types.js";

export class NodeTransportSender implements TransportSender {
  public async send(url: string, body: IngestRequest): Promise<IngestResponse> {
    if (typeof fetch === "function") {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Ingest HTTP error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as IngestResponse;
      return {
        received: typeof data.received === "number" ? data.received : body.events.length,
        stored: typeof data.stored === "number" ? data.stored : body.events.length,
        failed: typeof data.failed === "number" ? data.failed : 0,
      };
    }

    throw new Error("No fetch implementation available in Node environment");
  }
}
