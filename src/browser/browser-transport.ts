import { utf8ByteLength } from "../core/event-sanitizer.js";
import type { IngestRequest, IngestResponse, TransportSender } from "../core/types.js";

// Browsers restrict keepalive / sendBeacon payloads to 64KB across all concurrent requests
const SAFE_KEEPALIVE_BYTE_LIMIT = 60 * 1024;

export class BrowserTransportSender implements TransportSender {
  public async send(
    url: string,
    body: IngestRequest,
    options: { keepalive?: boolean } = {},
  ): Promise<IngestResponse> {
    const jsonString = JSON.stringify(body);
    const byteLength = utf8ByteLength(jsonString);

    // If keepalive is requested and sendBeacon is available, try sendBeacon if payload fits within safe limit
    if (
      options.keepalive &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      byteLength <= SAFE_KEEPALIVE_BYTE_LIMIT
    ) {
      try {
        const blob = new Blob([jsonString], { type: "application/json" });
        const enqueued = navigator.sendBeacon(url, blob);
        if (enqueued) {
          return {
            received: body.events.length,
            stored: 0,
            failed: 0,
            acknowledged: true,
          };
        }
      } catch {
        // Fallback to fetch keepalive
      }
    }

    if (typeof fetch === "function") {
      // Only set keepalive: true if payload fits in browser 64KB keepalive limit
      const useKeepalive = Boolean(options.keepalive && byteLength <= SAFE_KEEPALIVE_BYTE_LIMIT);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: jsonString,
        keepalive: useKeepalive,
      });

      if (!response.ok) {
        throw new Error(`Ingest HTTP error: ${String(response.status)} ${response.statusText}`);
      }

      const data = (await response.json()) as IngestResponse;
      return {
        received: typeof data.received === "number" ? data.received : body.events.length,
        stored: typeof data.stored === "number" ? data.stored : body.events.length,
        failed: typeof data.failed === "number" ? data.failed : 0,
      };
    }

    throw new Error("No browser transport available (neither fetch nor sendBeacon found)");
  }
}
