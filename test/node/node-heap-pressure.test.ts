import { describe, expect, it } from "vitest";
import { NodeHeapPressureMonitor } from "../../src/node/node-heap-pressure.js";

describe("node heap pressure monitor", () => {
  it("caches V8 reads and rejects events at the configured high-water mark", () => {
    let reads = 0;
    const monitor = new NodeHeapPressureMonitor(
      { maxHeapUsageRatio: 0.85, checkIntervalMs: 1_000 },
      () => {
        reads++;
        return reads === 1
          ? { used_heap_size: 700, heap_size_limit: 1_000 }
          : { used_heap_size: 850, heap_size_limit: 1_000 };
      },
    );

    expect(monitor.canAccept(0)).toBe(true);
    expect(monitor.canAccept(999)).toBe(true);
    expect(reads).toBe(1);

    expect(monitor.canAccept(1_000)).toBe(false);
    expect(monitor.getSnapshot(1_000)).toMatchObject({ usageRatio: 0.85 });
    expect(reads).toBe(2);
  });
});
