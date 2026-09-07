import { getHeapStatistics } from "node:v8";

export interface NodeHeapGuardOptions {
  /** Reject new SDK events when used V8 heap reaches this fraction. Default: 0.85. */
  maxHeapUsageRatio?: number;
  /** Minimum time between V8 reads on the request path. Default: 1,000 ms. */
  checkIntervalMs?: number;
}

export interface NodeHeapPressureSnapshot {
  usedHeapBytes: number;
  heapLimitBytes: number;
  usageRatio: number;
  observedAt: number;
}

type HeapStatisticsProvider = () => Pick<ReturnType<typeof getHeapStatistics>, "used_heap_size" | "heap_size_limit">;

/**
 * Node-only, process-wide V8 heap guard. This intentionally reports overall
 * heap pressure, not an invented per-event V8 object size. The SDK's portable
 * UTF-8 queue budget remains the primary per-event bound.
 */
export class NodeHeapPressureMonitor {
  private readonly maxHeapUsageRatio: number;
  private readonly checkIntervalMs: number;
  private lastSnapshot: NodeHeapPressureSnapshot | undefined;

  constructor(
    options: NodeHeapGuardOptions = {},
    private readonly readHeapStatistics: HeapStatisticsProvider = getHeapStatistics,
  ) {
    this.maxHeapUsageRatio = validRatio(options.maxHeapUsageRatio) ?? 0.85;
    this.checkIntervalMs = validInterval(options.checkIntervalMs) ?? 1_000;
  }

  /** Returns false only when the cached/refreshed V8 heap usage is at or above the configured limit. */
  public canAccept(now = Date.now()): boolean {
    return this.getSnapshot(now).usageRatio < this.maxHeapUsageRatio;
  }

  public getSnapshot(now = Date.now()): NodeHeapPressureSnapshot {
    if (!this.lastSnapshot || now - this.lastSnapshot.observedAt >= this.checkIntervalMs) {
      const heap = this.readHeapStatistics();
      const heapLimitBytes = Math.max(1, heap.heap_size_limit);
      this.lastSnapshot = {
        usedHeapBytes: heap.used_heap_size,
        heapLimitBytes,
        usageRatio: heap.used_heap_size / heapLimitBytes,
        observedAt: now,
      };
    }
    return this.lastSnapshot;
  }
}

function validRatio(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1
    ? value
    : undefined;
}

function validInterval(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
