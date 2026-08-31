import { FetchBatchTransport } from "./fetch-batch-transport.js";
import {
  MICHI_EVENT_NAMES,
  type AnonymousIdentity,
  type BatchTransport,
  type EventFields,
  type FlushResult,
  type LogFriendsClientOptions,
  type LogFriendsEvent,
  type MichiEventName,
  type SafeContext,
  type SafeContextPrimitive,
  type SafeContextValue,
} from "./types.js";

const eventNameAllowlist = new Set<string>(MICHI_EVENT_NAMES);
const blockedContextKey = /(authorization|cookie|credential|email|e-mail|name|password|phone|request.?text|secret|token)/iu;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new Error(`${label} must be an opaque 1-255 character identifier.`);
  }
}

function cloneContext(context: SafeContext | undefined): SafeContext {
  if (!context) return Object.freeze({});
  const entries = Object.entries(context);
  if (entries.length > 32) throw new Error("Event context supports at most 32 keys.");

  const result: Record<string, SafeContextValue> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || blockedContextKey.test(key)) {
      throw new Error(`Unsafe event context key: ${key}`);
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 20) throw new Error(`Event context array is too large: ${key}`);
    for (const item of values) {
      const validPrimitive =
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean";
      if (!validPrimitive || (typeof item === "string" && item.length > 500)) {
        throw new Error(`Event context must contain short primitive values: ${key}`);
      }
    }
    const safeValue = Array.isArray(value)
      ? Object.freeze((value as readonly SafeContextPrimitive[]).map((item) => item))
      : value;
    result[key] = safeValue;
  }
  return Object.freeze(result);
}

export class LogFriendsClient {
  private readonly transport: BatchTransport | undefined;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly now: () => Date;
  private readonly queue: LogFriendsEvent[] = [];
  private sessionId?: string;
  private activeFlush: Promise<FlushResult> | undefined;

  constructor(options: LogFriendsClientOptions = {}) {
    this.transport =
      options.transport ??
      (options.endpoint ? new FetchBatchTransport(options.endpoint, options.fetch) : undefined);
    this.batchSize = normalizePositiveInteger(options.batchSize, 20);
    this.maxQueueSize = normalizePositiveInteger(options.maxQueueSize, 200);
    this.now = options.now ?? ((): Date => new Date());
  }

  identify(identity: AnonymousIdentity): void {
    assertIdentifier(identity.sessionId, "sessionId");
    this.sessionId = identity.sessionId;
  }

  track(eventName: MichiEventName, fields: EventFields = {}): boolean {
    if (!eventNameAllowlist.has(eventName)) throw new Error(`Unsupported event name: ${eventName}`);
    if (!this.sessionId) return false;
    if (fields.tripId !== undefined) assertIdentifier(fields.tripId, "tripId");
    if (fields.placeId !== undefined) assertIdentifier(fields.placeId, "placeId");

    const timestamp = fields.timestamp ?? this.now().toISOString();
    if (!Number.isFinite(Date.parse(timestamp))) throw new Error("timestamp must be ISO 8601 compatible.");

    const event: LogFriendsEvent = {
      eventName,
      sessionId: this.sessionId,
      timestamp,
      context: cloneContext(fields.context),
    };
    if (fields.tripId !== undefined) event.tripId = fields.tripId;
    if (fields.placeId !== undefined) event.placeId = fields.placeId;

    if (this.queue.length >= this.maxQueueSize) this.queue.shift();
    this.queue.push(Object.freeze(event));
    return true;
  }

  flush(): Promise<FlushResult> {
    if (this.activeFlush) return this.activeFlush;
    this.activeFlush = this.performFlush().finally(() => {
      this.activeFlush = undefined;
    });
    return this.activeFlush;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  pendingEvents(): readonly LogFriendsEvent[] {
    return this.queue.map((event) => ({ ...event, context: { ...event.context } }));
  }

  private async performFlush(): Promise<FlushResult> {
    if (this.queue.length === 0) return { status: "empty", sent: 0, pending: 0 };
    if (!this.transport) return { status: "disabled", sent: 0, pending: this.queue.length };

    let sent = 0;
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.batchSize);
      try {
        await this.transport.send(batch);
      } catch {
        return { status: "failed", sent, pending: this.queue.length };
      }
      this.queue.splice(0, batch.length);
      sent += batch.length;
    }
    return { status: "sent", sent, pending: 0 };
  }
}
