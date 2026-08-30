import { estimateByteSize } from "./event-sanitizer.js";
import type { ClientEvent, QueueOverflowPolicy } from "./types.js";

export interface QueueOptions {
  maxSize?: number;
  maxBytes?: number;
  maxEventBytes?: number;
  overflowPolicy?: QueueOverflowPolicy;
}

export interface PushResult {
  accepted: boolean;
  droppedCount: number;
  reason?: "EVENT_TOO_LARGE" | "QUEUE_FULL";
}

export class BoundedEventQueue {
  private items: ClientEvent[] = [];
  private currentBytes = 0;
  private readonly maxSize: number;
  private readonly maxBytes: number;
  private readonly maxEventBytes: number;
  private readonly overflowPolicy: QueueOverflowPolicy;

  constructor(options: QueueOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024; // 2MB
    this.maxEventBytes = options.maxEventBytes ?? 32 * 1024; // 32KB
    this.overflowPolicy = options.overflowPolicy ?? "DROP_OLDEST";
  }

  public get size(): number {
    return this.items.length;
  }

  public get bytes(): number {
    return this.currentBytes;
  }

  public push(event: ClientEvent): PushResult {
    const eventBytes = estimateByteSize(event);

    if (eventBytes > this.maxEventBytes) {
      return {
        accepted: false,
        droppedCount: 1,
        reason: "EVENT_TOO_LARGE",
      };
    }

    let droppedCount = 0;

    // Check if adding this exceeds bounds
    while (
      this.items.length >= this.maxSize ||
      (this.items.length > 0 && this.currentBytes + eventBytes > this.maxBytes)
    ) {
      if (this.overflowPolicy === "DROP_NEWEST") {
        return {
          accepted: false,
          droppedCount: 1,
          reason: "QUEUE_FULL",
        };
      }

      // DROP_OLDEST
      const oldest = this.items.shift();
      if (oldest) {
        this.currentBytes -= estimateByteSize(oldest);
        droppedCount++;
      }
    }

    this.items.push(event);
    this.currentBytes += eventBytes;

    return {
      accepted: true,
      droppedCount,
    };
  }

  public drain(maxCount: number, maxBatchBytes?: number): ClientEvent[] {
    if (this.items.length === 0 || maxCount <= 0) {
      return [];
    }

    const batch: ClientEvent[] = [];
    let batchBytes = 0;
    const effectiveMaxBatchBytes = maxBatchBytes ?? Infinity;

    while (this.items.length > 0 && batch.length < maxCount) {
      const nextEvent = this.items[0];
      const nextBytes = estimateByteSize(nextEvent);

      if (batch.length > 0 && batchBytes + nextBytes > effectiveMaxBatchBytes) {
        break;
      }

      const item = this.items.shift();
      if (item === undefined) {
        break;
      }
      this.currentBytes -= nextBytes;
      batch.push(item);
      batchBytes += nextBytes;
    }

    // Ensure bytes does not become negative due to rounding
    if (this.items.length === 0) {
      this.currentBytes = 0;
    }

    return batch;
  }

  public prepend(events: ClientEvent[]): number {
    let droppedCount = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      const eventBytes = estimateByteSize(event);

      if (
        this.items.length >= this.maxSize ||
        this.currentBytes + eventBytes > this.maxBytes
      ) {
        if (this.overflowPolicy === "DROP_NEWEST") {
          droppedCount++;
          continue;
        }
        // DROP_OLDEST (which is at the end of queue when prepending)
        const dropped = this.items.pop();
        if (dropped) {
          this.currentBytes -= estimateByteSize(dropped);
          droppedCount++;
        }
      }

      this.items.unshift(event);
      this.currentBytes += eventBytes;
    }
    return droppedCount;
  }

  public updateAppInstanceId(appInstanceId: string): void {
    for (const item of this.items) {
      item.appInstanceId = appInstanceId;
    }
  }

  public clear(): void {
    this.items = [];
    this.currentBytes = 0;
  }
}
