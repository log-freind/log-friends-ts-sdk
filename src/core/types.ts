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
}

export interface TransportSender {
  send(url: string, body: IngestRequest, options?: { keepalive?: boolean }): Promise<IngestResponse>;
}

export interface UserTraits {
  [key: string]: unknown;
}
