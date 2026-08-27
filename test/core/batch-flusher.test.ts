import { describe, expect, it } from "vitest";
import { BatchFlusher } from "../../src/core/batch-flusher.js";
import { BoundedEventQueue } from "../../src/core/bounded-event-queue.js";
import type { ClientEvent, IngestRequest, IngestResponse, TransportSender } from "../../src/core/types.js";

function makeEvent(index: number): ClientEvent {
  return {
    type: "LOG_EVENT",
    timestamp: new Date().toISOString(),
    eventName: `action${index}`,
    payload: { id: index },
    eventId: `e-${index}`,
    sessionId: "sess-1",
  };
}

describe("batch-flusher", () => {
  it("batches and sends events to transport sender", async () => {
    const sentBatches: IngestRequest[] = [];
    const mockSender: TransportSender = {
      send: async (_url, body) => {
        sentBatches.push(body);
        return {
          received: body.events.length,
          stored: body.events.length,
          failed: 0,
        };
      },
    };

    const queue = new BoundedEventQueue({ maxSize: 100 });
    const flusher = new BatchFlusher(
      {
        ingestUrl: "http://localhost:8080/ingest",
        workerId: "test-worker",
        sourceType: "NODE",
        batchSize: 3,
        flushIntervalMs: 0, // Manual flush
      },
      queue,
      mockSender,
    );

    for (let i = 0; i < 5; i++) {
      flusher.enqueue(makeEvent(i));
    }

    const flushResult = await flusher.flush();
    expect(flushResult.success).toBe(true);
    expect(flushResult.sentCount).toBe(5);
    expect(sentBatches).toHaveLength(2); // 3 in first batch, 2 in second batch
    expect(sentBatches[0].events).toHaveLength(3);
    expect(sentBatches[1].events).toHaveLength(2);

    const stats = flusher.getStats();
    expect(stats.captured).toBe(5);
    expect(stats.sent).toBe(5);
    expect(stats.dropped).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.inFlight).toBe(0);
    expect(stats.accounted).toBe(5);
  });

  it("retries failed batches with backoff and marks dropped if all retries fail", async () => {
    let callCount = 0;
    const mockSender: TransportSender = {
      send: async () => {
        callCount++;
        throw new Error("503 Service Unavailable");
      },
    };

    const queue = new BoundedEventQueue({ maxSize: 100 });
    const flusher = new BatchFlusher(
      {
        ingestUrl: "http://localhost:8080/ingest",
        workerId: "test-worker",
        sourceType: "NODE",
        batchSize: 5,
        maxRetries: 2,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 50,
        flushIntervalMs: 0,
      },
      queue,
      mockSender,
    );

    flusher.enqueue(makeEvent(0));
    flusher.enqueue(makeEvent(1));

    const result = await flusher.flush();
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(2);
    expect(callCount).toBe(3); // 1 initial + 2 retries

    const stats = flusher.getStats();
    expect(stats.captured).toBe(2);
    expect(stats.dropped).toBe(2);
    expect(stats.sent).toBe(0);
    expect(stats.accounted).toBe(2);
  });

  it("shares in-flight flush promise when concurrent flushes are invoked", async () => {
    let resolveSend: (val: IngestResponse) => void;
    const sendPromise = new Promise<IngestResponse>((resolve) => {
      resolveSend = resolve;
    });

    const mockSender: TransportSender = {
      send: async (_url, body) => {
        return sendPromise.then(() => ({
          received: body.events.length,
          stored: body.events.length,
          failed: 0,
        }));
      },
    };

    const queue = new BoundedEventQueue({ maxSize: 100 });
    const flusher = new BatchFlusher(
      {
        ingestUrl: "http://localhost:8080/ingest",
        workerId: "test-worker",
        sourceType: "NODE",
        batchSize: 10,
        flushIntervalMs: 0,
      },
      queue,
      mockSender,
    );

    flusher.enqueue(makeEvent(0));

    // Call flush concurrently
    const f1 = flusher.flush();
    const f2 = flusher.flush();

    expect(f1).toBe(f2); // Exactly same promise shared

    resolveSend!({ received: 1, stored: 1, failed: 0 });
    const [r1, r2] = await Promise.all([f1, f2]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});
