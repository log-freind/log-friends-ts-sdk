import type { BaseLogFriendsClient } from "../core/base-client.js";
import type { DiscoveredEventSpec } from "../decorators/log-field.js";

export interface FieldHint {
  name: string;
  description?: string;
  type?: string;
  required: boolean;
  example?: unknown;
}

export interface DiscoveredEventCandidate {
  eventName: string;
  sourceClass: string;
  sourceMethod: string;
  parameterNames: string[];
  specHint?: {
    description?: string;
    apiMethod?: string;
    apiPath?: string;
    apiDescription?: string;
    fields: FieldHint[];
  };
}

export interface ReportEventsOptions {
  appName?: string;
  appVersion?: string;
  agentId?: number | string;
  events?: DiscoveredEventCandidate[];
}

export interface ReportEventsResult {
  success: boolean;
  received: number;
  error?: Error;
}

class DiscoveredEventRegistry {
  private readonly events = new Map<string, DiscoveredEventCandidate>();

  public register(spec: DiscoveredEventSpec): void {
    const candidate: DiscoveredEventCandidate = {
      eventName: spec.eventName,
      sourceClass: spec.sourceClass,
      sourceMethod: spec.sourceMethod,
      parameterNames: spec.parameterNames,
      specHint: {
        description: spec.description,
        fields: spec.fields.map((f) => ({
          name: f.name,
          description: f.description,
          type: f.type,
          required: f.required,
          example: f.example,
        })),
      },
    };
    this.events.set(spec.eventName, candidate);
  }

  public registerCustom(candidate: DiscoveredEventCandidate): void {
    this.events.set(candidate.eventName, candidate);
  }

  public getAll(): DiscoveredEventCandidate[] {
    return Array.from(this.events.values());
  }

  public clear(): void {
    this.events.clear();
  }
}

export const discoveredEventRegistry = new DiscoveredEventRegistry();

/**
 * Reports all discovered @LogEvent and defineEvent() metadata to Log Friends Console,
 * matching Kotlin SDK's DiscoveredLogEventReportClient (`POST /api/agents/{agentId}/discovered-log-events`).
 */
export async function reportDiscoveredEvents(
  client: BaseLogFriendsClient,
  options: ReportEventsOptions = {},
): Promise<ReportEventsResult> {
  const eventsToReport = options.events ?? discoveredEventRegistry.getAll();
  if (eventsToReport.length === 0) {
    return { success: true, received: 0 };
  }

  // Access protected or public config fields from client
  const clientConfig = (client as unknown as { config: { ingestUrl: string; workerId: string } }).config;
  const ingestUrl = clientConfig?.ingestUrl ?? "http://localhost:8080/ingest";
  const workerId = clientConfig?.workerId ?? "default-worker";
  const appName = options.appName ?? workerId;
  const appVersion = options.appVersion ?? "1.0.0";

  // Build target URL
  const baseUrl = ingestUrl.replace(/\/ingest\/?$/, "");
  if (options.agentId === undefined || options.agentId === null || options.agentId === "") {
    return {
      success: false,
      received: 0,
      error: new Error("Discovered event reporting requires an agentId returned by agent registration."),
    };
  }
  const agentId = options.agentId;
  const reportUrl = `${baseUrl}/api/agents/${agentId}/discovered-log-events`;

  const requestBody = {
    workerId,
    appName,
    appVersion,
    events: eventsToReport,
  };

  try {
    if (typeof fetch === "function") {
      const response = await fetch(reportUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Fallback: don't crash the application if schema report endpoint is not configured
        return {
          success: false,
          received: 0,
          error: new Error(`Report HTTP ${response.status}: ${response.statusText}`),
        };
      }

      return {
        success: true,
        received: eventsToReport.length,
      };
    }
    return { success: false, received: 0, error: new Error("fetch is not available in environment") };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      success: false,
      received: 0,
      error,
    };
  }
}
