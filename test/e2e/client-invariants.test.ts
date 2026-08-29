import { describe, expect, it } from "vitest";
import { BaseLogFriendsClient } from "../../src/core/base-client.js";
import type { IngestRequest, IngestResponse, TransportSender } from "../../src/core/types.js";

class TestLogFriendsClient extends BaseLogFriendsClient {
  protected override resolveSessionId(): string {
    return "test-session";
  }
  protected override resolveAppInstanceId(): undefined {
    return undefined;
  }
}

describe("client-invariants", () => {
  it("strictly satisfies captured = sent + dropped + queued + inFlight invariant under burst load and partial server failures", async () => {
    let callCounter = 0;
    const mockSender: TransportSender = {
      send: async (_url: string, body: IngestRequest): Promise<IngestResponse> => {
        callCounter++;
        // Intermittently fail every 3rd request
        if (callCounter % 3 === 0) {
          throw new Error("Temporary network error");
        }
        // Partial storage success
        const count = body.events.length;
        const stored = Math.floor(count * 0.8);
        const failed = count - stored;
        return {
          received: count,
          stored,
          failed,
        };
      },
    };

    const client = new TestLogFriendsClient(
      {
        ingestUrl: "http://localhost:8080/ingest",
        workerId: "test-invariants-worker",
        sourceType: "NODE",
        batchSize: 10,
        maxQueueSize: 50,
        maxRetries: 1,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 15,
        flushIntervalMs: 0,
      },
      mockSender,
    );

    // Track 200 events into a maxQueueSize of 50
    for (let i = 0; i < 200; i++) {
      client.track(`burstEvent${i}`, { index: i });
    }

    const midStats = client.getStats();
    expect(midStats.captured).toBe(200);
    expect(midStats.accounted).toBe(200);
    expect(midStats.sent + midStats.dropped + midStats.queued + midStats.inFlight).toBe(200);

    // Flush everything
    await client.flush();

    const endStats = client.getStats();
    expect(endStats.captured).toBe(200);
    expect(endStats.accounted).toBe(200);
    expect(endStats.queued).toBe(0);
    expect(endStats.inFlight).toBe(0);
    expect(endStats.sent + endStats.dropped).toBe(200);

    await client.shutdown();
  });
});
