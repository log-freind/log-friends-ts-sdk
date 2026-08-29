import { BaseLogFriendsClient } from "../core/base-client.js";
import type { ClientConfig } from "../core/types.js";
import { BrowserSessionManager, type BrowserSessionConfig } from "./browser-session-manager.js";
import { BrowserTransportSender } from "./browser-transport.js";

export interface BrowserClientConfig extends Omit<ClientConfig, "sourceType">, BrowserSessionConfig {
  autoTrackVisibility?: boolean;
  autoTrackOnline?: boolean;
}

export class BrowserLogFriendsClient extends BaseLogFriendsClient {
  private readonly sessionManager: BrowserSessionManager;
  private readonly cleanupCallbacks: Array<() => void> = [];

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
    });

    this.setupBrowserListeners(config);
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

  public resetSession(): string {
    return this.sessionManager.resetSession();
  }

  public override async shutdown(timeoutMs = 1500) {
    this.cleanupListeners();
    return super.shutdown(timeoutMs);
  }

  private setupBrowserListeners(config: BrowserClientConfig): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return; // SSR-safe guard
    }

    if (config.autoTrackOnline !== false) {
      const handleOnline = () => {
        void this.flush();
      };
      window.addEventListener("online", handleOnline);
      this.cleanupCallbacks.push(() => window.removeEventListener("online", handleOnline));
    }

    if (config.autoTrackVisibility !== false) {
      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          void this.flush({ keepalive: true });
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      this.cleanupCallbacks.push(() =>
        document.removeEventListener("visibilitychange", handleVisibilityChange),
      );

      const handlePageHide = () => {
        void this.flush({ keepalive: true });
      };
      window.addEventListener("pagehide", handlePageHide);
      this.cleanupCallbacks.push(() => window.removeEventListener("pagehide", handlePageHide));
    }
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

export function createBrowserClient(config: BrowserClientConfig): BrowserLogFriendsClient {
  return new BrowserLogFriendsClient(config);
}
