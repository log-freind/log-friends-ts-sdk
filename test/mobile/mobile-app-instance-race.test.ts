import { describe, expect, it, vi } from "vitest";
import { createMobileClient } from "../../src/mobile/mobile-client.js";
import type { MobileStorageAdapter } from "../../src/mobile/mobile-adapters.js";
import type { IngestRequest } from "../../src/core/types.js";

describe("mobile-app-instance-race", () => {
  it("ensures initial track calls resolve to stable persistent appInstanceId without race conditions", async () => {
    let capturedRequests: IngestRequest[] = [];

    // Simulate async storage with 50ms delay
    const mockStorage: MobileStorageAdapter = {
      getItem: vi.fn(async (_key: string) => {
        await new Promise((r) => setTimeout(r, 50));
        return "persisted-device-uuid-9999";
      }),
      setItem: vi.fn(async (_key: string, _value: string) => {}),
      removeItem: vi.fn(async (_key: string) => {}),
    };

    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as IngestRequest;
      capturedRequests.push(body);
      return new Response(
        JSON.stringify({ received: body.events.length, stored: body.events.length, failed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = createMobileClient({
      ingestUrl: "http://localhost:8080/ingest",
      workerId: "mobile-app-ios",
      storageAdapter: mockStorage,
      flushIntervalMs: 0,
    });

    // Track immediately before storage resolves
    client.track("appLaunched", { launchType: "cold" });
    client.track("screenViewed", { screen: "Home" });

    // Flush immediately
    await client.flush();

    expect(capturedRequests.length).toBeGreaterThan(0);
    const sentEvents = capturedRequests.flatMap((r) => r.events);
    expect(sentEvents).toHaveLength(2);

    // Both events MUST have the resolved persistent appInstanceId, NOT a random temporary ID
    expect(sentEvents[0].appInstanceId).toBe("persisted-device-uuid-9999");
    expect(sentEvents[1].appInstanceId).toBe("persisted-device-uuid-9999");
    expect(client.getAppInstanceId()).toBe("persisted-device-uuid-9999");

    await client.shutdown();
  });

  it("handles storage failure gracefully with fallback in-memory ID and does not block tracking", async () => {
    const failingStorage: MobileStorageAdapter = {
      getItem: vi.fn(async () => {
        throw new Error("Disk IO storage read failed");
      }),
      setItem: vi.fn(async () => {
        throw new Error("Disk IO storage write failed");
      }),
      removeItem: vi.fn(async () => {}),
    };

    const client = createMobileClient({
      ingestUrl: "http://localhost:8080/ingest",
      workerId: "mobile-app-fallback",
      storageAdapter: failingStorage,
      flushIntervalMs: 0,
    });

    const readyClient = await client.ready();
    expect(readyClient.isStorageInitialized()).toBe(true);

    const fallbackId = readyClient.getAppInstanceId();
    expect(fallbackId).toBeDefined();
    expect(fallbackId.length).toBeGreaterThan(10);

    readyClient.track("itemClicked", { itemId: "101" });
    const stats = readyClient.getStats();
    expect(stats.captured).toBe(1);

    await readyClient.shutdown();
  });

  it("allows explicit ready() awaiting and maintains single stable ID across concurrent track calls", async () => {
    const inMemoryStorage: MobileStorageAdapter = {
      getItem: vi.fn(async () => "stable-single-instance-id"),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    };

    const client = createMobileClient({
      ingestUrl: "http://localhost:8080/ingest",
      workerId: "mobile-concurrent-worker",
      storageAdapter: inMemoryStorage,
      flushIntervalMs: 0,
    });

    await client.ready();

    // 20 concurrent track calls
    for (let i = 0; i < 20; i++) {
      client.track(`event${i}`, { index: i });
    }

    expect(client.getAppInstanceId()).toBe("stable-single-instance-id");
    expect(client.getStats().captured).toBe(20);

    await client.shutdown();
  });
});
