import { BaseLogFriendsClient } from "../core/base-client.js";
import type { ClientConfig, FlushResult, TrackOptions, UiContext } from "../core/types.js";
import { registerAgent, type RegisterAgentResult } from "../discovery/agent-registration.js";
import { reportDiscoveredEvents } from "../discovery/event-discovery.js";
import { BrowserSessionManager, type BrowserSessionConfig } from "./browser-session-manager.js";
import { BrowserTransportSender } from "./browser-transport.js";

export interface BrowserClientConfig extends Omit<ClientConfig, "sourceType">, BrowserSessionConfig {
  autoTrackVisibility?: boolean;
  autoTrackOnline?: boolean;
  /**
   * Deprecated: Browser clients are not server Agents. Keep disabled until the
   * Console exposes a dedicated Browser App registration model.
   */
  autoRegister?: boolean | BrowserAutoRegistrationOptions;
}

export interface BrowserAutoRegistrationOptions {
  appName?: string;
  appVersion?: string;
  metadata?: Record<string, unknown>;
  reportDiscoveredEvents?: boolean;
}

export class BrowserLogFriendsClient extends BaseLogFriendsClient {
  private readonly sessionManager: BrowserSessionManager;
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly registrationPromise?: Promise<RegisterAgentResult>;

  constructor(config: BrowserClientConfig) {
    const fullConfig: ClientConfig = {
      immediate: config.immediate ?? true,
      ...config,
      sourceType: "BROWSER",
    };
    super(fullConfig, new BrowserTransportSender());

    this.sessionManager = new BrowserSessionManager({
      sessionTimeoutMs: config.sessionTimeoutMs,
      initialSessionId: config.initialSessionId,
      storageKeyPrefix: config.storageKeyPrefix ?? `logfriends_${config.workerId}`,
    });

    this.setupBrowserListeners(config);
    this.registrationPromise = this.startAutoRegistration(config.autoRegister);
  }

  protected override resolveSessionId(): string {
    return this.sessionManager.getSessionId();
  }

  protected override resolveAppInstanceId(): undefined {
    return undefined; // Browser clients do not use appInstanceId
  }

  public getSessionId(): string {
    return this.sessionManager.getSessionId();
  }

  /**
   * Browser events automatically include the current route. Add component metadata
   * through `options.uiContext` when a React component emits the event.
   */
  public override track(
    eventName: string,
    payload?: Record<string, unknown>,
    options: TrackOptions = {},
  ): boolean {
    return super.track(eventName, payload, {
      ...options,
      uiContext: this.resolveUiContext(options.uiContext),
    });
  }

  public resetSession(): string {
    return this.sessionManager.resetSession();
  }

  /** Resolves when optional startup agent registration has completed. */
  public getRegistrationPromise(): Promise<RegisterAgentResult> | undefined {
    return this.registrationPromise;
  }

  public override async shutdown(timeoutMs = 1500): Promise<FlushResult> {
    this.cleanupListeners();
    return super.shutdown(timeoutMs);
  }

  private setupBrowserListeners(config: BrowserClientConfig): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return; // SSR-safe guard
    }

    if (config.autoTrackOnline !== false) {
      const handleOnline = (): void => {
        void this.flush();
      };
      window.addEventListener("online", handleOnline);
      this.cleanupCallbacks.push((): void => { window.removeEventListener("online", handleOnline); });
    }

    if (config.autoTrackVisibility !== false) {
      const handleVisibilityChange = (): void => {
        if (document.visibilityState === "hidden") {
          void this.flush({ keepalive: true });
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      this.cleanupCallbacks.push((): void => { document.removeEventListener("visibilitychange", handleVisibilityChange); },
      );

      const handlePageHide = (): void => {
        void this.flush({ keepalive: true });
      };
      window.addEventListener("pagehide", handlePageHide);
      this.cleanupCallbacks.push((): void => { window.removeEventListener("pagehide", handlePageHide); });
    }
  }

  private resolveUiContext(context: UiContext | undefined): UiContext | undefined {
    const page = context?.page ?? currentBrowserPage();
    if (!page && !context) return undefined;
    return { ...context, ...(page ? { page } : {}) };
  }

  private startAutoRegistration(
    option: BrowserClientConfig["autoRegister"],
  ): Promise<RegisterAgentResult> | undefined {
    if (!option || typeof window === "undefined") {
      return undefined;
    }

    const options: BrowserAutoRegistrationOptions = option === true ? {} : option;
    return registerAgent(this, {
      appName: options.appName ?? this.config.workerId,
      appVersion: options.appVersion,
      sourceType: "BROWSER",
      metadata: options.metadata,
    }).then(async (result) => {
      if (!result.success || result.agentId === undefined) {
        this.handleError(result.error ?? new Error("Browser agent registration failed"), "registerAgent");
        return result;
      }

      if (options.reportDiscoveredEvents !== false) {
        const report = await reportDiscoveredEvents(this, {
          appName: options.appName ?? this.config.workerId,
          appVersion: options.appVersion,
          agentId: result.agentId,
        });
        if (!report.success) {
          this.handleError(report.error ?? new Error("Browser event schema report failed"), "reportDiscoveredEvents");
        }
      }

      return result;
    }).catch((error: unknown) => {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.handleError(resolvedError, "registerAgent");
      return { success: false, error: resolvedError };
    });
  }

  private cleanupListeners(): void {
    while (this.cleanupCallbacks.length > 0) {
      const cleanup = this.cleanupCallbacks.pop();
      try {
        cleanup?.();
      } catch {
        // ignore
      }
    }
  }
}

function currentBrowserPage(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function createBrowserClient(config: BrowserClientConfig): BrowserLogFriendsClient {
  return new BrowserLogFriendsClient(config);
}
