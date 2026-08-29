import { describe, expect, it, vi } from "vitest";
import { createMobileClient } from "../../src/mobile/mobile-client.js";
import type {
  MobileLifecycleAdapter,
  MobileNetworkAdapter,
  MobileStorageAdapter,
} from "../../src/mobile/mobile-adapters.js";

describe("mobile-client", () => {
  it("persists appInstanceId via custom MobileStorageAdapter and separates it from sessionId", async () => {
    const memory = new Map<string, string>();
    const mockStorage: MobileStorageAdapter = {
      getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
      setItem: vi.fn(async (key: string, val: string) => {
        memory.set(key, val);
      }),
      removeItem: vi.fn(async (key: string) => {
        memory.delete(key);
      }),
    };

    const client = createMobileClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "mobile-app-prod",
      storageAdapter: mockStorage,
      initialAppInstanceId: "app-inst-999",
    });

    const appInstanceId = client.getAppInstanceId();
    const sessionId1 = client.getSessionId();

    expect(appInstanceId).toBe("app-inst-999");
    expect(sessionId1).toBeDefined();

    // Resetting session changes sessionId but maintains appInstanceId
    const sessionId2 = client.resetSession();
    expect(sessionId2).not.toBe(sessionId1);
    expect(client.getAppInstanceId()).toBe("app-inst-999");

    await client.shutdown();
  });

  it("responds to foreground, background, and network restoration events", async () => {
    let foregroundHandler: (() => void) | undefined;
    let backgroundHandler: (() => void) | undefined;
    let networkRestoredHandler: (() => void) | undefined;

    const mockLifecycle: MobileLifecycleAdapter = {
      onForeground: (cb) => {
        foregroundHandler = cb;
        return () => {};
      },
      onBackground: (cb) => {
        backgroundHandler = cb;
        return () => {};
      },
    };

    const mockNetwork: MobileNetworkAdapter = {
      onNetworkRestored: (cb) => {
        networkRestoredHandler = cb;
        return () => {};
      },
    };

    const client = createMobileClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "mobile-app-prod",
      lifecycleAdapter: mockLifecycle,
      networkAdapter: mockNetwork,
      flushIntervalMs: 0,
    });

    const flushSpy = vi.spyOn(client, "flush").mockResolvedValue({
      success: true,
      sentCount: 0,
      failedCount: 0,
    });

    foregroundHandler?.();
    expect(flushSpy).toHaveBeenCalledTimes(1);

    backgroundHandler?.();
    expect(flushSpy).toHaveBeenCalledTimes(2);

    networkRestoredHandler?.();
    expect(flushSpy).toHaveBeenCalledTimes(3);

    await client.shutdown();
  });
});
