import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserTransportSender } from "../../src/browser/browser-transport.js";
import { createBrowserClient } from "../../src/browser/browser-client.js";
import type { IngestRequest } from "../../src/core/types.js";

describe("browser-lifecycle-beacon", () => {
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    globalThis.fetch = originalFetch;
  });

  it("handles sendBeacon acknowledgement without fabricating stored server count", async () => {
    let beaconCalled = false;

    const mockSendBeacon = vi.fn((_url: string, _data?: BodyInit | null) => {
      beaconCalled = true;
      return true;
    });

    Object.defineProperty(globalThis, "navigator", {
      value: { sendBeacon: mockSendBeacon },
      configurable: true,
      writable: true,
    });

    const sender = new BrowserTransportSender();
    const request: IngestRequest = {
      workerId: "browser-worker-1",
      events: [
        {
          type: "LOG_EVENT",
          timestamp: "2026-08-27T06:00:00Z",
          eventName: "pageUnloaded",
          eventId: "evt-1",
        },
      ],
    };

    const response = await sender.send("http://localhost:8080/ingest", request, { keepalive: true });

    expect(beaconCalled).toBe(true);
    expect(response.acknowledged).toBe(true);
    expect(response.stored).toBe(0); // Explicitly NOT fabricated as stored
    expect(response.received).toBe(1);
    expect(response.failed).toBe(0);
  });

  it("falls back to fetch keepalive when sendBeacon fails or returns false", async () => {
    let fetchCalled = false;
    let keepaliveUsed = false;

    Object.defineProperty(globalThis, "navigator", {
      value: {
        sendBeacon: vi.fn(() => false), // returns false indicating browser rejected beacon
      },
      configurable: true,
      writable: true,
    });

    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalled = true;
      keepaliveUsed = Boolean(init?.keepalive);
      return new Response(JSON.stringify({ received: 1, stored: 1, failed: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const sender = new BrowserTransportSender();
    const request: IngestRequest = {
      workerId: "browser-worker-1",
      events: [
        {
          type: "LOG_EVENT",
          timestamp: "2026-08-27T06:00:00Z",
          eventName: "tabClosed",
          eventId: "evt-2",
        },
      ],
    };

    const response = await sender.send("http://localhost:8080/ingest", request, { keepalive: true });

    expect(fetchCalled).toBe(true);
    expect(keepaliveUsed).toBe(true);
    expect(response.stored).toBe(1);
  });

  it("does not attach keepalive when payload UTF-8 bytes exceed safe 60KB limit", async () => {
    let keepaliveUsed = false;

    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      keepaliveUsed = Boolean(init?.keepalive);
      return new Response(JSON.stringify({ received: 1, stored: 1, failed: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const sender = new BrowserTransportSender();
    // Large payload ~70KB
    const largeString = "한글문자열테스트".repeat(4000);
    const request: IngestRequest = {
      workerId: "browser-worker-1",
      events: [
        {
          type: "LOG_EVENT",
          timestamp: "2026-08-27T06:00:00Z",
          eventName: "largeDataExport",
          payload: { text: largeString },
        },
      ],
    };

    await sender.send("http://localhost:8080/ingest", request, { keepalive: true });
    // Over 60KB: keepalive should be omitted to prevent browser exception
    expect(keepaliveUsed).toBe(false);
  });

  it("maintains strict stats invariant during browser client lifecycle flushes", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        sendBeacon: vi.fn(() => true),
      },
      configurable: true,
      writable: true,
    });

    const client = createBrowserClient({
      ingestUrl: "http://localhost:8080/ingest",
      workerId: "browser-stats-worker",
      flushIntervalMs: 0,
    });

    client.track("pageHidden", { reason: "navigation" });
    client.track("pageUnloaded", { reason: "close" });

    const beforeStats = client.getStats();
    expect(beforeStats.captured).toBe(2);
    expect(beforeStats.queued).toBe(2);
    expect(beforeStats.accounted).toBe(2);

    const result = await client.flush({ keepalive: true });
    expect(result.success).toBe(true);
    expect(result.acknowledgedCount).toBe(2);

    const afterStats = client.getStats();
    expect(afterStats.captured).toBe(2);
    expect(afterStats.queued).toBe(0);
    expect(afterStats.sent).toBe(2);
    expect(afterStats.dropped).toBe(0);
    expect(afterStats.accounted).toBe(2);

    await client.shutdown();
  });
});
