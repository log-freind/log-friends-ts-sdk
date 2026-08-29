import { describe, expect, it } from "vitest";
import { BoundedEventQueue } from "../../src/core/bounded-event-queue.js";
import type { ClientEvent } from "../../src/core/types.js";

function makeEvent(index: number, payloadSize = 10): ClientEvent {
  return {
    type: "LOG_EVENT",
    timestamp: new Date().toISOString(),
    eventName: `event${index}`,
    payload: { data: "x".repeat(payloadSize) },
    eventId: `evt-${index}`,
    sessionId: "sess-1",
  };
}

describe("bounded-event-queue", () => {
  it("enforces max items limit with DROP_OLDEST policy", () => {
    const queue = new BoundedEventQueue({ maxSize: 5, overflowPolicy: "DROP_OLDEST" });

    for (let i = 0; i < 5; i++) {
      const res = queue.push(makeEvent(i));
      expect(res.accepted).toBe(true);
      expect(res.droppedCount).toBe(0);
    }
    expect(queue.size).toBe(5);

    // Push 6th item -> oldest (0) should be dropped
    const res6 = queue.push(makeEvent(5));
    expect(res6.accepted).toBe(true);
    expect(res6.droppedCount).toBe(1);
    expect(queue.size).toBe(5);

    const drained = queue.drain(10);
    expect(drained.map((e) => e.eventId)).toEqual(["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"]);
  });

  it("enforces max items limit with DROP_NEWEST policy", () => {
    const queue = new BoundedEventQueue({ maxSize: 3, overflowPolicy: "DROP_NEWEST" });

    queue.push(makeEvent(0));
    queue.push(makeEvent(1));
    queue.push(makeEvent(2));

    // 4th item should be rejected
    const res = queue.push(makeEvent(3));
    expect(res.accepted).toBe(false);
    expect(res.droppedCount).toBe(1);
    expect(res.reason).toBe("QUEUE_FULL");
    expect(queue.size).toBe(3);

    const drained = queue.drain(10);
    expect(drained.map((e) => e.eventId)).toEqual(["evt-0", "evt-1", "evt-2"]);
  });

  it("rejects single events exceeding maxEventBytes immediately", () => {
    const queue = new BoundedEventQueue({ maxEventBytes: 100 });
    const largeEvent = makeEvent(1, 500);

    const res = queue.push(largeEvent);
    expect(res.accepted).toBe(false);
    expect(res.droppedCount).toBe(1);
    expect(res.reason).toBe("EVENT_TOO_LARGE");
    expect(queue.size).toBe(0);
  });

  it("drains up to maxCount and maxBatchBytes", () => {
    const queue = new BoundedEventQueue({ maxSize: 10 });
    for (let i = 0; i < 5; i++) {
      queue.push(makeEvent(i, 50));
    }

    const firstBatch = queue.drain(2);
    expect(firstBatch).toHaveLength(2);
    expect(queue.size).toBe(3);

    const remaining = queue.drain(10);
    expect(remaining).toHaveLength(3);
    expect(queue.size).toBe(0);
  });

  it("prepends retry events safely without corrupting queue bounds", () => {
    const queue = new BoundedEventQueue({ maxSize: 4, overflowPolicy: "DROP_OLDEST" });
    queue.push(makeEvent(3));
    queue.push(makeEvent(4));

    const retrying = [makeEvent(1), makeEvent(2)];
    queue.prepend(retrying);

    expect(queue.size).toBe(4);
    const drained = queue.drain(10);
    expect(drained.map((e) => e.eventId)).toEqual(["evt-1", "evt-2", "evt-3", "evt-4"]);
  });
});
