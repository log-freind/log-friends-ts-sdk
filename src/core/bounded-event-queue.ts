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

export interface DrainedEventBatch {
  events: ClientEvent[];
  /** UTF-8 serialized byte estimate retained by this batch until it settles. */
  byteSize: number;
}

/**
 * A named wrapper makes Log Friends queue entries discoverable in a Node V8
 * heap snapshot. It also caches the serialized-byte estimate so drain and
 * overflow handling do not serialize the same event repeatedly.
 */
class LogFriendsQueueEntry {
  constructor(
    public readonly event: ClientEvent,
    public readonly byteSize: number,
  ) {}
}

export class BoundedEventQueue {
  private items: LogFriendsQueueEntry[] = [];
  private currentBytes = 0;
  private inFlightBytes = 0;
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

  /** Bytes held by queued events and batches currently being delivered. */
  public get retainedBytes(): number {
    return this.currentBytes + this.inFlightBytes;
  }

  public get deliveringBytes(): number {
    return this.inFlightBytes;
  }

  public get byteCapacity(): number {
    return this.maxBytes;
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
      this.retainedBytes + eventBytes > this.maxBytes
    ) {
      // An in-flight batch can consume the entire byte budget. It cannot be
      // evicted safely, so the new event must be rejected even for DROP_OLDEST.
      if (this.overflowPolicy === "DROP_NEWEST" || this.items.length === 0) {
        return {
          accepted: false,
          droppedCount: 1,
          reason: "QUEUE_FULL",
        };
      }

      // DROP_OLDEST
      const oldest = this.items.shift();
      if (oldest) {
        this.currentBytes -= oldest.byteSize;
        droppedCount++;
      }
    }

    this.items.push(new LogFriendsQueueEntry(event, eventBytes));
    this.currentBytes += eventBytes;

    return {
      accepted: true,
      droppedCount,
    };
  }

  public drain(maxCount: number, maxBatchBytes?: number): ClientEvent[] {
    const batch = this.takeBatch(maxCount, maxBatchBytes);
    // `drain` remains a convenience API for callers that do not send the
    // batch asynchronously. BatchFlusher uses takeBatch/releaseBatch instead.
    this.releaseBatch(batch.byteSize);
    return batch.events;
  }

  public takeBatch(maxCount: number, maxBatchBytes?: number): DrainedEventBatch {
    if (this.items.length === 0 || maxCount <= 0) {
      return { events: [], byteSize: 0 };
    }

    const batch: ClientEvent[] = [];
    let batchBytes = 0;
    const effectiveMaxBatchBytes = maxBatchBytes ?? Infinity;

    while (this.items.length > 0 && batch.length < maxCount) {
      const nextEntry = this.items[0];
      const nextBytes = nextEntry.byteSize;

      if (batch.length > 0 && batchBytes + nextBytes > effectiveMaxBatchBytes) {
        break;
      }

      const entry = this.items.shift();
      if (entry === undefined) {
        break;
      }
      this.currentBytes -= nextBytes;
      batch.push(entry.event);
      batchBytes += nextBytes;
    }

    // Ensure bytes does not become negative due to rounding
    if (this.items.length === 0) {
      this.currentBytes = 0;
    }

    this.inFlightBytes += batchBytes;
    return { events: batch, byteSize: batchBytes };
  }

  public releaseBatch(byteSize: number): void {
    this.inFlightBytes = Math.max(0, this.inFlightBytes - byteSize);
  }

  public prepend(events: ClientEvent[]): number {
    let droppedCount = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      const eventBytes = estimateByteSize(event);

      if (
        this.items.length >= this.maxSize ||
        this.retainedBytes + eventBytes > this.maxBytes
      ) {
        if (this.overflowPolicy === "DROP_NEWEST" || this.items.length === 0) {
          droppedCount++;
          continue;
        }
        // DROP_OLDEST (which is at the end of queue when prepending)
        const dropped = this.items.pop();
        if (dropped) {
          this.currentBytes -= dropped.byteSize;
          droppedCount++;
        }
      }

      this.items.unshift(new LogFriendsQueueEntry(event, eventBytes));
      this.currentBytes += eventBytes;
    }
    return droppedCount;
  }

  public updateAppInstanceId(appInstanceId: string): void {
    for (const item of this.items) {
      item.event.appInstanceId = appInstanceId;
    }
  }

  public clear(): void {
    this.items = [];
    this.currentBytes = 0;
    this.inFlightBytes = 0;
  }
}
