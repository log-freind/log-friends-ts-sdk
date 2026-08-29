import { describe, expect, it, vi } from "vitest";
import { createNodeClient } from "../../src/node/node-client.js";

describe("node-client", () => {
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
    expect(body.events[0].sessionId).toBe("server-session-001");
    expect(body.events[0].payload).toEqual({ orderId: "ord-12345", total: 49000 });

    await client.shutdown();
  });
});
