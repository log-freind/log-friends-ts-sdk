import { BaseLogFriendsClient } from "../core/base-client.js";
import { generateEventId } from "../core/event-sanitizer.js";
import type { ClientConfig, FlushResult, IngestRequest, IngestResponse, TransportSender } from "../core/types.js";
import {
  InMemoryMobileStorageAdapter,
  type MobileLifecycleAdapter,
  type MobileNetworkAdapter,
  type MobileStorageAdapter,
} from "./mobile-adapters.js";

const APP_INSTANCE_ID_KEY = "logfriends_app_instance_id";

export interface MobileClientConfig extends Omit<ClientConfig, "sourceType"> {
  storageAdapter?: MobileStorageAdapter;
  lifecycleAdapter?: MobileLifecycleAdapter;
  networkAdapter?: MobileNetworkAdapter;
  sessionTimeoutMs?: number;
  initialAppInstanceId?: string;
}

export class MobileTransportSender implements TransportSender {
  public async send(url: string, body: IngestRequest): Promise<IngestResponse> {
    if (typeof fetch === "function") {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Ingest HTTP error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as IngestResponse;
      return {
        received: typeof data.received === "number" ? data.received : body.events.length,
        stored: typeof data.stored === "number" ? data.stored : body.events.length,
        failed: typeof data.failed === "number" ? data.failed : 0,
      };
    }

    throw new Error("No fetch implementation available in mobile environment");
  }
}

export class MobileLogFriendsClient extends BaseLogFriendsClient {
  private readonly storage: MobileStorageAdapter;
  private readonly sessionTimeoutMs: number;
  private readonly cleanupCallbacks: Array<() => void> = [];

  private currentSessionId: string;
  private currentAppInstanceId: string;
  private lastActiveTs: number;
  private isInitialized = false;
  private readonly initPromise: Promise<void>;

  constructor(config: MobileClientConfig) {
    const fullConfig: ClientConfig = {
      immediate: config.immediate ?? true,
      ...config,
      sourceType: "MOBILE",
    };

    let selfRef: MobileLogFriendsClient | null = null;
    super(fullConfig, new MobileTransportSender(), async () => {
      if (selfRef) {
        await selfRef.ready();
        selfRef.queue.updateAppInstanceId(selfRef.currentAppInstanceId);
      }
    });
    selfRef = this;

    this.storage = config.storageAdapter ?? new InMemoryMobileStorageAdapter();
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000;
    this.currentSessionId = generateEventId();
    this.lastActiveTs = Date.now();
    this.currentAppInstanceId = config.initialAppInstanceId ?? generateEventId();

    this.initPromise = this.initAppInstanceId();
    this.setupAdapters(config);
  }

  private async initAppInstanceId(): Promise<void> {
    try {
      const stored = await this.storage.getItem(APP_INSTANCE_ID_KEY);
      if (stored && typeof stored === "string" && stored.trim().length > 0) {
        this.currentAppInstanceId = stored.trim();
      } else {
        await this.storage.setItem(APP_INSTANCE_ID_KEY, this.currentAppInstanceId);
      }
    } catch (err) {
      if (this.config.debug) {
        console.warn("[Log Friends] MobileStorageAdapter failed; falling back to in-memory ID:", err);
      }
    } finally {
      this.isInitialized = true;
    }
  }

  /**
   * Waits for persistent storage initialization (e.g. appInstanceId) to complete.
   */
  public async ready(): Promise<this> {
    await this.initPromise;
    return this;
  }

  private setupAdapters(config: MobileClientConfig): void {
    if (config.lifecycleAdapter?.onForeground) {
      const unsub = config.lifecycleAdapter.onForeground(() => {
        this.checkSessionRotation();
        void this.flush();
      });
      this.cleanupCallbacks.push(unsub);
    }

    if (config.lifecycleAdapter?.onBackground) {
      const unsub = config.lifecycleAdapter.onBackground(() => {
        this.lastActiveTs = Date.now();
        void this.flush();
      });
      this.cleanupCallbacks.push(unsub);
    }

    if (config.networkAdapter?.onNetworkRestored) {
      const unsub = config.networkAdapter.onNetworkRestored(() => {
        void this.flush();
      });
      this.cleanupCallbacks.push(unsub);
    }
  }

  private checkSessionRotation(): void {
    const now = Date.now();
    if (now - this.lastActiveTs > this.sessionTimeoutMs) {
      this.currentSessionId = generateEventId();
    }
    this.lastActiveTs = now;
  }

  protected override resolveSessionId(): string {
    this.checkSessionRotation();
    return this.currentSessionId;
  }

  protected override resolveAppInstanceId(): string {
    return this.currentAppInstanceId;
  }

  public getSessionId(): string {
    return this.resolveSessionId();
  }

  public getAppInstanceId(): string {
    return this.currentAppInstanceId;
  }

  public isStorageInitialized(): boolean {
    return this.isInitialized;
  }

  public resetSession(): string {
    this.currentSessionId = generateEventId();
    this.lastActiveTs = Date.now();
    return this.currentSessionId;
  }

  public override async shutdown(timeoutMs = 1500): Promise<FlushResult> {
    while (this.cleanupCallbacks.length > 0) {
      try {
        this.cleanupCallbacks.pop()?.();
      } catch {
        // ignore
      }
    }
    return super.shutdown(timeoutMs);
  }
}

export function createMobileClient(config: MobileClientConfig): MobileLogFriendsClient {
  return new MobileLogFriendsClient(config);
}
