import { BaseLogFriendsClient } from "../core/base-client.js";
import type { ClientConfig } from "../core/types.js";
import { NodeTransportSender } from "./node-transport.js";

export interface NodeClientConfig extends Omit<ClientConfig, "sourceType"> {
  autoHookProcessSignals?: boolean;
  defaultSessionId?: string;
}

export class NodeLogFriendsClient extends BaseLogFriendsClient {
  private readonly defaultSessionId?: string;
  private readonly cleanupCallbacks: Array<() => void> = [];

  constructor(config: NodeClientConfig) {
    const fullConfig: ClientConfig = {
      ...config,
      sourceType: "NODE",
    };
    super(fullConfig, new NodeTransportSender());
    this.defaultSessionId = config.defaultSessionId;

    this.setupProcessHooks(config);
  }

  protected override resolveSessionId(): string | undefined {
    return this.defaultSessionId;
  }

  protected override resolveAppInstanceId(): undefined {
    return undefined;
  }

  public override async shutdown(timeoutMs = 1500) {
    while (this.cleanupCallbacks.length > 0) {
      try {
        this.cleanupCallbacks.pop()?.();
      } catch {
        // ignore
      }
    }
    return super.shutdown(timeoutMs);
  }

  private setupProcessHooks(config: NodeClientConfig): void {
    if (config.autoHookProcessSignals === false) return;
    if (typeof process === "undefined" || typeof process.on !== "function") return;

    const handleSignal = async (signal: string) => {
      if (this.config.debug) {
        console.log(`[Log Friends] Received ${signal}, flushing events before exit...`);
      }
      await this.shutdown(1200);
    };

    const sigtermHandler = () => {
      void handleSignal("SIGTERM");
    };
    const sigintHandler = () => {
      void handleSignal("SIGINT");
    };
    const beforeExitHandler = () => {
      void handleSignal("beforeExit");
    };

    process.once("SIGTERM", sigtermHandler);
    process.once("SIGINT", sigintHandler);
    process.once("beforeExit", beforeExitHandler);

    this.cleanupCallbacks.push(() => {
      process.removeListener("SIGTERM", sigtermHandler);
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("beforeExit", beforeExitHandler);
    });
  }
}

export function createNodeClient(config: NodeClientConfig): NodeLogFriendsClient {
  return new NodeLogFriendsClient(config);
}
