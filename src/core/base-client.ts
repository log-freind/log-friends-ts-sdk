import { BatchFlusher } from "./batch-flusher.js";
import { BoundedEventQueue } from "./bounded-event-queue.js";
import {
  generateEventId,
  isValidEventName,
  sanitizePayload,
} from "./event-sanitizer.js";
import type {
  ClientConfig,
  ClientEvent,
  ClientStats,
  FlushResult,
  TrackOptions,
  TransportSender,
  UserTraits,
} from "./types.js";
import { SDK_VERSION } from "../version.js";

export abstract class BaseLogFriendsClient {
  protected readonly config: ClientConfig;
  protected readonly queue: BoundedEventQueue;
  protected readonly flusher: BatchFlusher;

  protected currentUserId: string | null = null;
  protected currentUserTraits: Record<string, unknown> = {};

  constructor(
    config: ClientConfig,
    sender: TransportSender,
    beforeFlushHook?: () => Promise<void>,
    admissionGuard?: () => boolean,
  ) {
    this.config = config;
    this.queue = new BoundedEventQueue({
      maxSize: config.maxQueueSize,
      maxBytes: config.maxQueueBytes,
      maxEventBytes: config.maxEventBytes,
      overflowPolicy: config.queueOverflowPolicy,
    });
    this.flusher = new BatchFlusher(config, this.queue, sender, beforeFlushHook, admissionGuard);
  }

  /**
   * Sets or updates current user identification.
   */
  public identify(userId: string | null, traits?: UserTraits): void {
    try {
      this.currentUserId = userId;
      this.currentUserTraits = traits ? (sanitizePayload(traits) ?? {}) : {};
    } catch (err) {
      this.handleError(err, "identify");
    }
  }

  /**
   * Resets identified user state (e.g. on user logout) without rotating sessionId.
   */
  public resetIdentity(): void {
    this.currentUserId = null;
    this.currentUserTraits = {};
  }

  /**
   * Returns current identified user context.
   */
  public getIdentity(): { userId: string | null; traits: Record<string, unknown> } {
    return {
      userId: this.currentUserId,
      traits: { ...this.currentUserTraits },
    };
  }

  /**
   * Records a business or client event.
   */
  public track(
    eventName: string,
    payload?: Record<string, unknown>,
    options: TrackOptions = {},
  ): boolean {
    try {
      if (!isValidEventName(eventName)) {
        if (this.config.debug) {
          console.warn(
            `[Log Friends] Invalid eventName: "${eventName}". Must be camelCase (e.g. orderCompleted).`,
          );
        }
        return false;
      }

      const timestamp = options.timestamp
        ? options.timestamp instanceof Date
          ? options.timestamp.toISOString()
        : options.timestamp
        : new Date().toISOString();

      const eventId = options.eventId ?? generateEventId();
      const sessionId = options.sessionId ?? this.resolveSessionId();
      const appInstanceId = options.appInstanceId ?? this.resolveAppInstanceId();

      // Build payload with user context if identified
      let finalPayload: Record<string, unknown> | undefined;
      const sanitizedUserPayload = sanitizePayload(payload);

      if (this.currentUserId || Object.keys(this.currentUserTraits).length > 0) {
        finalPayload = {
          ...(sanitizedUserPayload ?? {}),
          _user: {
            id: this.currentUserId,
            ...(Object.keys(this.currentUserTraits).length > 0
              ? { traits: this.currentUserTraits }
              : {}),
          },
        };
      } else {
        finalPayload = sanitizedUserPayload;
      }

      const event: ClientEvent = {
        type: "LOG_EVENT",
        timestamp,
        eventName,
        payload: finalPayload,
        eventId,
        sessionId,
        appInstanceId,
        sdkName: this.config.sdkName ?? "@logfriends/sdk",
        sdkVersion: this.config.sdkVersion ?? SDK_VERSION,
        ...(options.uiContext ? { uiContext: sanitizeUiContext(options.uiContext) } : {}),
      };

      const enqueued = this.flusher.enqueue(event);
      if (enqueued && (options.immediate ?? this.config.immediate ?? false)) {
        void this.flush();
      }
      return enqueued;
    } catch (err) {
      this.handleError(err, "track");
      return false;
    }
  }

  /**
   * Triggers an immediate batch flush.
   */
  public flush(options: { keepalive?: boolean } = {}): Promise<FlushResult> {
    try {
      return this.flusher.flush(options);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.handleError(error, "flush");
      return Promise.resolve({
        success: false,
        sentCount: 0,
        failedCount: this.queue.size,
        error,
      });
    }
  }

  /**
   * Returns current transport and queue statistics.
   */
  public getStats(): ClientStats {
    try {
      return this.flusher.getStats();
    } catch {
      return {
        captured: 0,
        sent: 0,
        dropped: 0,
        queued: 0,
        inFlight: 0,
        accounted: 0,
        queuedBytes: 0,
        inFlightBytes: 0,
        retainedBytes: 0,
        maxQueueBytes: this.config.maxQueueBytes ?? 2 * 1024 * 1024,
      };
    }
  }

  /**
   * Gracefully shuts down SDK timers and flushes remaining queue.
   */
  public async shutdown(timeoutMs = 1500): Promise<FlushResult> {
    try {
      return await this.flusher.shutdown(timeoutMs);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        success: false,
        sentCount: 0,
        failedCount: this.queue.size,
        error,
      };
    }
  }

  public getUserId(): string | null {
    return this.currentUserId;
  }

  protected abstract resolveSessionId(): string | undefined;

  protected abstract resolveAppInstanceId(): string | undefined;

  protected handleError(err: unknown, context: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this.config.onError) {
      try {
        this.config.onError(error, context);
      } catch {
        // Prevent onError from throwing
      }
    }
    if (this.config.debug) {
      console.error(`[Log Friends] Error in ${context}:`, error);
    }
  }
}

function sanitizeUiContext(context: TrackOptions["uiContext"]): TrackOptions["uiContext"] {
  if (!context) return undefined;

  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 300) : undefined;
  const componentPath = Array.isArray(context.componentPath)
    ? context.componentPath.map(text).filter((value): value is string => value !== undefined).slice(0, 32)
    : undefined;
  const component = text(context.component) ?? componentPath?.at(-1);
  const parentComponent = text(context.parentComponent) ??
    (componentPath && componentPath.length > 1 ? componentPath.at(-2) : undefined);
  const page = text(context.page);

  if (!page && !component && !parentComponent && !componentPath?.length) return undefined;
  return {
    ...(page ? { page } : {}),
    ...(component ? { component } : {}),
    ...(parentComponent ? { parentComponent } : {}),
    ...(componentPath?.length ? { componentPath } : {}),
  };
}
