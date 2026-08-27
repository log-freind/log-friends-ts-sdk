import { BoundedEventQueue } from "./bounded-event-queue.js";
import type {
  ClientConfig,
  ClientEvent,
  ClientStats,
  FlushResult,
  IngestRequest,
  TransportSender,
} from "./types.js";

export class BatchFlusher {
  private readonly config: Required<ClientConfig>;
  private readonly queue: BoundedEventQueue;
  private readonly sender: TransportSender;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private inFlightPromise: Promise<FlushResult> | null = null;
  private isShuttingDown = false;
  private beforeFlushHook?: () => Promise<void>;

  // Stats counters
  private capturedCount = 0;
  private sentCount = 0;
  private droppedCount = 0;
  private inFlightCount = 0;

  constructor(
    config: ClientConfig,
    queue: BoundedEventQueue,
    sender: TransportSender,
    beforeFlushHook?: () => Promise<void>,
  ) {
    this.config = {
      ingestUrl: config.ingestUrl,
      workerId: config.workerId,
      sourceType: config.sourceType,
      sdkName: config.sdkName ?? "@logfriends/sdk",
      sdkVersion: config.sdkVersion ?? "1.0.0",
      batchSize: config.batchSize ?? 20,
      flushIntervalMs: config.flushIntervalMs ?? 5000,
      maxQueueSize: config.maxQueueSize ?? 1000,
      maxQueueBytes: config.maxQueueBytes ?? 2 * 1024 * 1024,
      maxEventBytes: config.maxEventBytes ?? 32 * 1024,
      maxBatchBytes: config.maxBatchBytes ?? 256 * 1024,
      queueOverflowPolicy: config.queueOverflowPolicy ?? "DROP_OLDEST",
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 200,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 3000,
      debug: config.debug ?? false,
      onError: config.onError ?? (() => {}),
    };
    this.queue = queue;
    this.sender = sender;
    this.beforeFlushHook = beforeFlushHook;

    this.startTimer();
  }

  public enqueue(event: ClientEvent): boolean {
    this.capturedCount++;

    const result = this.queue.push(event);
    if (result.droppedCount > 0) {
      this.droppedCount += result.droppedCount;
    }

    if (!result.accepted) {
      if (this.config.debug) {
        console.warn(`[Log Friends] Event rejected: ${result.reason}`);
      }
      return false;
    }

    if (this.queue.size >= this.config.batchSize) {
      // Trigger async flush if batch threshold is reached
      void this.flush();
    }

    return true;
  }

  public getStats(): ClientStats {
    const queued = this.queue.size;
    const inFlight = this.inFlightCount;
    const sent = this.sentCount;
    const dropped = this.droppedCount;
    const captured = this.capturedCount;

    return {
      captured,
      sent,
      dropped,
      queued,
      inFlight,
      accounted: sent + dropped + queued + inFlight,
    };
  }

  public flush(options: { keepalive?: boolean } = {}): Promise<FlushResult> {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = this.performFlush(options).finally(() => {
      this.inFlightPromise = null;
    });

    return this.inFlightPromise;
  }

  private async performFlush(options: { keepalive?: boolean }): Promise<FlushResult> {
    if (this.beforeFlushHook) {
      try {
        await this.beforeFlushHook();
      } catch {
        // Fall through safely
      }
    }

    let totalSent = 0;
    let totalFailed = 0;
    let totalAcknowledged = 0;
    let lastError: Error | undefined;

    while (this.queue.size > 0) {
      const batch = this.queue.drain(this.config.batchSize, this.config.maxBatchBytes);
      if (batch.length === 0) break;

      this.inFlightCount += batch.length;

      const requestBody: IngestRequest = {
        workerId: this.config.workerId,
        events: batch,
      };

      try {
        const response = await this.sendWithRetry(requestBody, options);
        this.inFlightCount -= batch.length;

        if (response.acknowledged) {
          // Browser queued via sendBeacon: acknowledged by client transport
          this.sentCount += batch.length;
          totalSent += batch.length;
          totalAcknowledged += batch.length;
        } else {
          // Standard server HTTP response
          const stored = typeof response.stored === "number" ? Math.max(0, response.stored) : 0;
          const failed = typeof response.failed === "number" ? Math.max(0, response.failed) : 0;

          if (stored + failed === batch.length) {
            this.sentCount += stored;
            this.droppedCount += failed;
            totalSent += stored;
            totalFailed += failed;
          } else {
            // Server returned malformed or mismatching count: protect invariant
            const safeStored = Math.min(stored, batch.length);
            const unaccountedFailed = batch.length - safeStored;

            this.sentCount += safeStored;
            this.droppedCount += unaccountedFailed;
            totalSent += safeStored;
            totalFailed += unaccountedFailed;

            if (this.config.debug) {
              console.warn(
                `[Log Friends] Server response mismatch. Stored: ${stored}, Failed: ${failed}, Batch: ${batch.length}`,
              );
            }
          }
        }
      } catch (err) {
        this.inFlightCount -= batch.length;
        this.droppedCount += batch.length;
        totalFailed += batch.length;
        lastError = err instanceof Error ? err : new Error(String(err));

        this.config.onError(lastError, "BatchFlusher.sendWithRetry");

        if (this.config.debug) {
          console.error("[Log Friends] Failed to flush batch after retries:", lastError);
        }
      }
    }

    return {
      success: totalFailed === 0,
      sentCount: totalSent,
      failedCount: totalFailed,
      acknowledgedCount: totalAcknowledged > 0 ? totalAcknowledged : undefined,
      error: lastError,
    };
  }

  private async sendWithRetry(
    request: IngestRequest,
    options: { keepalive?: boolean },
  ) {
    let attempt = 0;
    let delay = this.config.initialRetryDelayMs;

    while (true) {
      try {
        return await this.sender.send(this.config.ingestUrl, request, options);
      } catch (err) {
        attempt++;
        if (attempt > this.config.maxRetries || this.isShuttingDown || options.keepalive) {
          throw err;
        }

        // Exponential backoff with jitter
        const jitter = Math.random() * 0.3 * delay;
        const sleepMs = Math.min(delay + jitter, this.config.maxRetryDelayMs);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        delay = Math.min(delay * 2, this.config.maxRetryDelayMs);
      }
    }
  }

  public startTimer(): void {
    if (this.timerId !== null) return;
    if (this.config.flushIntervalMs > 0) {
      this.timerId = setInterval(() => {
        void this.flush();
      }, this.config.flushIntervalMs);

      // Node.js unref if available so timer does not hold process open
      if (typeof this.timerId === "object" && "unref" in this.timerId) {
        (this.timerId as unknown as { unref: () => void }).unref();
      }
    }
  }

  public stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public async shutdown(timeoutMs = 1500): Promise<FlushResult> {
    this.isShuttingDown = true;
    this.stopTimer();

    const flushPromise = this.flush();
    const timeoutPromise = new Promise<FlushResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            success: false,
            sentCount: 0,
            failedCount: this.queue.size,
            error: new Error("Shutdown flush timeout exceeded"),
          }),
        timeoutMs,
      ),
    );

    return Promise.race([flushPromise, timeoutPromise]);
  }
}
