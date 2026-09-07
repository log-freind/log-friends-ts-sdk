export type SourceType = "JVM" | "NODE" | "BROWSER" | "MOBILE";

export type QueueOverflowPolicy = "DROP_OLDEST" | "DROP_NEWEST";

export interface ClientEvent {
  type: string;
  timestamp: string;
  eventName?: string;
  payload?: Record<string, unknown>;
  eventId?: string;
  sessionId?: string;
  appInstanceId?: string;
  sdkName?: string;
  sdkVersion?: string;
  /** Browser UI location attached separately from the business-event payload. */
  uiContext?: UiContext;
}

/**
 * Identifies the browser page and React/component branch that produced an event.
 * `componentPath` is ordered from the page child to the emitting component.
 */
export interface UiContext {
  page?: string;
  component?: string;
  parentComponent?: string;
  componentPath?: string[];
}

export interface IngestRequest {
  workerId: string;
  events: ClientEvent[];
}

export interface IngestResponse {
  received: number;
  stored: number;
  failed: number;
  acknowledged?: boolean;
}

export interface ClientConfig {
  ingestUrl: string;
  workerId: string;
  sourceType: SourceType;
  sdkName?: string;
  sdkVersion?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxQueueBytes?: number;
  maxEventBytes?: number;
  maxBatchBytes?: number;
  queueOverflowPolicy?: QueueOverflowPolicy;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  immediate?: boolean;
  debug?: boolean;
  onError?: (error: Error, context: string) => void;
}

export interface ClientStats {
  captured: number;
  sent: number;
  dropped: number;
  queued: number;
  inFlight: number;
  accounted: number;
  /** Serialized UTF-8 bytes held by events still in the queue. */
  queuedBytes: number;
  /** Serialized UTF-8 bytes held by batches currently being delivered. */
  inFlightBytes: number;
  /** Queue and in-flight byte reservation combined. */
  retainedBytes: number;
  maxQueueBytes: number;
}

export interface FlushResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  acknowledgedCount?: number;
  error?: Error;
}

export interface TrackOptions {
  timestamp?: string | Date;
  eventId?: string;
  sessionId?: string;
  appInstanceId?: string;
  immediate?: boolean;
  uiContext?: UiContext;
}

export interface TransportSender {
  send(url: string, body: IngestRequest, options?: { keepalive?: boolean }): Promise<IngestResponse>;
}

export interface UserTraits {
  [key: string]: unknown;
}
