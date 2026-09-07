import { BaseLogFriendsClient } from "../core/base-client.js";
import type { ClientConfig, FlushResult } from "../core/types.js";
import { NodeHeapPressureMonitor, type NodeHeapGuardOptions, type NodeHeapPressureSnapshot } from "./node-heap-pressure.js";
import { NodeTransportSender } from "./node-transport.js";

export interface NodeClientConfig extends Omit<ClientConfig, "sourceType" | "ingestUrl" | "workerId"> {
  /** Optional when LOGFRIENDS_INGEST_URL is set in the Node process environment. */
  ingestUrl?: string;
  /** Optional when LOGFRIENDS_WORKER_ID is set in the Node process environment. */
  workerId?: string;
  autoHookProcessSignals?: boolean;
  defaultSessionId?: string;
  /** Optional Node-only process heap guard. Disabled unless configured. */
  heapGuard?: NodeHeapGuardOptions;
}

/**
 * Node-only environment resolver. Environment values intentionally take
 * precedence, matching the Kotlin SDK's deployment configuration contract.
 * Browser and mobile entry points never read process.env.
 */
export function resolveNodeRuntimeConfig(
  config: NodeClientConfig,
  environment: NodeJS.ProcessEnv = process.env,
): ClientConfig {
  const clientConfig = { ...config };
  delete clientConfig.autoHookProcessSignals;
  delete clientConfig.defaultSessionId;
  delete clientConfig.heapGuard;

  return {
    ...clientConfig,
    ingestUrl: resolveText(environment.LOGFRIENDS_INGEST_URL, config.ingestUrl) ?? "",
    workerId: resolveText(environment.LOGFRIENDS_WORKER_ID, config.workerId) ?? "",
    sourceType: "NODE",
    batchSize: resolvePositiveInteger(environment.LOGFRIENDS_BATCH_SIZE, config.batchSize),
    flushIntervalMs: resolveNonNegativeInteger(
      environment.LOGFRIENDS_BATCH_INTERVAL_MS,
      config.flushIntervalMs,
    ),
    maxQueueSize: resolvePositiveInteger(
      environment.LOGFRIENDS_QUEUE_CAPACITY,
      config.maxQueueSize,
    ),
    // This is a portable UTF-8 payload budget, not an exact V8 object heap budget.
    maxQueueBytes: resolvePositiveInteger(
      environment.LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES,
      config.maxQueueBytes,
    ),
  };
}

export class NodeLogFriendsClient extends BaseLogFriendsClient {
  private readonly defaultSessionId?: string;
  private readonly heapPressureMonitor?: NodeHeapPressureMonitor;
  private readonly cleanupCallbacks: Array<() => void> = [];

  constructor(config: NodeClientConfig) {
    const fullConfig = resolveNodeRuntimeConfig(config);
    const heapPressureMonitor = config.heapGuard
      ? new NodeHeapPressureMonitor(config.heapGuard)
      : undefined;
    super(fullConfig, new NodeTransportSender(), undefined, () => heapPressureMonitor?.canAccept() ?? true);
    this.defaultSessionId = config.defaultSessionId;
    this.heapPressureMonitor = heapPressureMonitor;

    this.setupProcessHooks(config);
  }

  protected override resolveSessionId(): string | undefined {
    return this.defaultSessionId;
  }

  protected override resolveAppInstanceId(): undefined {
    return undefined;
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

  /** Returns the latest Node-wide V8 heap observation when heapGuard is enabled. */
  public getHeapPressure(): NodeHeapPressureSnapshot | undefined {
    return this.heapPressureMonitor?.getSnapshot();
  }

  private setupProcessHooks(config: NodeClientConfig): void {
    if (config.autoHookProcessSignals === false) return;
    if (typeof process === "undefined" || typeof process.on !== "function") return;

    let terminationStarted = false;
    const handleSignal = async (signal: NodeJS.Signals): Promise<void> => {
      if (terminationStarted) return;
      terminationStarted = true;
      if (this.config.debug) {
        console.log(`[Log Friends] Received ${signal}, flushing events before exit...`);
      }
      await this.shutdown(1200);
      try {
        process.kill(process.pid, signal);
      } catch (error) {
        this.handleError(error, `process.kill(${signal})`);
      }
    };

    const sigtermHandler = (): void => {
      void handleSignal("SIGTERM");
    };
    const sigintHandler = (): void => {
      void handleSignal("SIGINT");
    };
    const beforeExitHandler = (): void => {
      void this.shutdown(1200);
    };

    process.once("SIGTERM", sigtermHandler);
    process.once("SIGINT", sigintHandler);
    process.once("beforeExit", beforeExitHandler);

    this.cleanupCallbacks.push((): void => {
      process.removeListener("SIGTERM", sigtermHandler);
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("beforeExit", beforeExitHandler);
    });
  }
}

function resolveText(environmentValue: string | undefined, configuredValue: string | undefined): string | undefined {
  return environmentValue?.trim() || configuredValue?.trim() || undefined;
}

function resolvePositiveInteger(
  environmentValue: string | undefined,
  configuredValue: number | undefined,
): number | undefined {
  const parsedEnvironmentValue = environmentValue?.trim();
  if (parsedEnvironmentValue) {
    const numericValue = Number(parsedEnvironmentValue);
    if (Number.isInteger(numericValue) && numericValue > 0) return numericValue;
  }
  return typeof configuredValue === "number" && Number.isFinite(configuredValue) && configuredValue > 0
    ? Math.floor(configuredValue)
    : undefined;
}

function resolveNonNegativeInteger(
  environmentValue: string | undefined,
  configuredValue: number | undefined,
): number | undefined {
  const parsedEnvironmentValue = environmentValue?.trim();
  if (parsedEnvironmentValue) {
    const numericValue = Number(parsedEnvironmentValue);
    if (Number.isInteger(numericValue) && numericValue >= 0) return numericValue;
  }
  return typeof configuredValue === "number" && Number.isFinite(configuredValue) && configuredValue >= 0
    ? Math.floor(configuredValue)
    : undefined;
}

export function createNodeClient(config: NodeClientConfig): NodeLogFriendsClient {
  return new NodeLogFriendsClient(config);
}
