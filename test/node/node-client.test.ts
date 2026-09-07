import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeClient, resolveNodeRuntimeConfig } from "../../src/node/node-client.js";

describe("node-client", () => {
  it("uses Kotlin-aligned Node environment overrides for batch time, count, and payload budget", () => {
    const resolved = resolveNodeRuntimeConfig(
      {
        ingestUrl: "https://configured.example/ingest",
        workerId: "configured-worker",
        batchSize: 20,
        flushIntervalMs: 5_000,
        maxQueueSize: 1_000,
        maxQueueBytes: 2 * 1024 * 1024,
      },
      {
        LOGFRIENDS_INGEST_URL: "https://environment.example/ingest",
        LOGFRIENDS_WORKER_ID: "environment-worker",
        LOGFRIENDS_BATCH_SIZE: "100",
        LOGFRIENDS_BATCH_INTERVAL_MS: "500",
        LOGFRIENDS_QUEUE_CAPACITY: "10000",
        LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES: "33554432",
      },
    );

    expect(resolved).toMatchObject({
      ingestUrl: "https://environment.example/ingest",
      workerId: "environment-worker",
      batchSize: 100,
      flushIntervalMs: 500,
      maxQueueSize: 10_000,
      maxQueueBytes: 33_554_432,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a node client with sourceType NODE and sends events", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ received: 1, stored: 1, failed: 0 }),
    });
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    const client = createNodeClient({
      ingestUrl: "http://localhost:8080/ingest",
      workerId: "node-service-order",
      defaultSessionId: "server-session-001",
      autoHookProcessSignals: false,
    });

    const tracked = client.track("orderCreated", { orderId: "ord-12345", total: 49000 });
    expect(tracked).toBe(true);

    const flushRes = await client.flush();
    expect(flushRes.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.workerId).toBe("node-service-order");
    expect(body.events[0].type).toBe("LOG_EVENT");
    expect(body.events[0].eventName).toBe("orderCreated");
    expect(body.events[0].sdkVersion).toBe("1.0.12");
    expect(body.events[0].sessionId).toBe("server-session-001");
    expect(body.events[0].payload).toEqual({ orderId: "ord-12345", total: 49000 });

    await client.shutdown();
  });

  it("re-delivers termination signals after flushing", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    vi.spyOn(process, "once").mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.once);
    vi.spyOn(process, "removeListener").mockImplementation((() => process) as typeof process.removeListener);
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const client = createNodeClient({
      ingestUrl: "http://localhost:8080/ingest",
      workerId: "node-signal-worker",
      flushIntervalMs: 0,
    });

    handlers.get("SIGTERM")?.();

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
    });

    await client.shutdown();
  });
});
