import type { BaseLogFriendsClient } from "../core/base-client.js";
import { SDK_VERSION } from "../version.js";

export interface RegisterAgentOptions {
  appName: string;
  appVersion?: string;
  sourceType?: "NODE" | "BROWSER" | "MOBILE" | "JVM";
  metadata?: Record<string, unknown>;
}

export interface RegisterAgentResult {
  success: boolean;
  agentId?: number;
  error?: Error;
}

/**
 * Registers or refreshes the Console Agent before sending discovered event schemas.
 * `/ingest` never auto-registers an unknown worker, so callers must retain the
 * returned agentId for the subsequent Catalog report.
 */
export async function registerAgent(
  client: BaseLogFriendsClient,
  options: RegisterAgentOptions,
): Promise<RegisterAgentResult> {
  const config = (client as unknown as { config: { ingestUrl: string; workerId: string; sdkVersion?: string } }).config;
  const baseUrl = config.ingestUrl.replace(/\/ingest\/?$/, "");
  if (!baseUrl || !config.workerId || !options.appName) {
    return { success: false, error: new Error("Log Friends agent registration requires ingestUrl, workerId, and appName.") };
  }

  try {
    const response = await fetch(`${baseUrl}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workerId: config.workerId,
        appName: options.appName,
        sdkVersion: config.sdkVersion ?? SDK_VERSION,
        sourceType: options.sourceType ?? "NODE",
        metadata: {
          ...(options.metadata ?? {}),
          ...(options.appVersion ? { appVersion: options.appVersion } : {}),
        },
      }),
    });
    if (!response.ok) {
      return { success: false, error: new Error(`Agent registration HTTP ${String(response.status)}: ${response.statusText}`) };
    }
    const body = (await response.json()) as { agentId?: unknown };
    if (typeof body.agentId !== "number" || !Number.isFinite(body.agentId)) {
      return { success: false, error: new Error("Agent registration response did not include a numeric agentId.") };
    }
    return { success: true, agentId: body.agentId };
  } catch (cause) {
    return { success: false, error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}
