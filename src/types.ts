export const MICHI_EVENT_NAMES = [
  "trip_requested",
  "trip_generated",
  "place_viewed",
  "place_removed",
  "place_reordered",
  "place_added",
  "route_started",
  "route_completed",
] as const;

export type MichiEventName = (typeof MICHI_EVENT_NAMES)[number];

export type SafeContextPrimitive = string | number | boolean | null;
export type SafeContextValue = SafeContextPrimitive | readonly SafeContextPrimitive[];
export type SafeContext = Readonly<Record<string, SafeContextValue>>;

export interface AnonymousIdentity {
  /** Opaque anonymous identifier. Do not pass names, email addresses, phone numbers, or account IDs. */
  sessionId: string;
}

export interface EventFields {
  tripId?: string;
  placeId?: string;
  timestamp?: string;
  /** Explicit, flat, non-sensitive product metadata only. */
  context?: SafeContext;
}

export interface LogFriendsEvent {
  eventName: MichiEventName;
  sessionId: string;
  tripId?: string;
  placeId?: string;
  timestamp: string;
  context: SafeContext;
}

export interface BatchTransport {
  send(events: readonly LogFriendsEvent[]): Promise<void>;
}

export type FlushStatus = "sent" | "disabled" | "empty" | "failed";

export interface FlushResult {
  status: FlushStatus;
  sent: number;
  pending: number;
}

export interface LogFriendsClientOptions {
  /** Full ingest URL. No default is assumed and no request is made when omitted. */
  endpoint?: string;
  transport?: BatchTransport;
  fetch?: typeof globalThis.fetch;
  batchSize?: number;
  maxQueueSize?: number;
  now?: () => Date;
}
