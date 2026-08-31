import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient } from "../../src/browser/browser-client.js";

type Listener = () => void;

describe("browser-client", () => {
  let listeners: Record<string, Listener[]> = {};

  beforeEach(() => {
    listeners = {};
    (globalThis as unknown as { window: unknown; document: unknown }).window = {
      addEventListener: (type: string, fn: Listener) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: Listener) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
      sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      },
    };
    (globalThis as unknown as { document: unknown }).document = {
      visibilityState: "visible",
      addEventListener: (type: string, fn: Listener) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: Listener) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    vi.restoreAllMocks();
  });

  it("creates a browser client with sourceType BROWSER and records events", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ received: 1, stored: 1, failed: 0 }),
    });
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    const client = createBrowserClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "browser-app-prod",
      batchSize: 1,
    });

    client.identify("user-123", { plan: "pro" });
    const tracked = client.track("buttonClicked", { buttonId: "submit-order" });
    expect(tracked).toBe(true);

    const flushRes = await client.flush();
    expect(flushRes.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const callArg = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callArg.workerId).toBe("browser-app-prod");
    expect(callArg.events[0].type).toBe("LOG_EVENT");
    expect(callArg.events[0].eventName).toBe("buttonClicked");
    expect(callArg.events[0].sessionId).toBeDefined();
    expect(callArg.events[0].payload._user).toEqual({
      id: "user-123",
      traits: { plan: "pro" },
    });

    await client.shutdown();
  });

  it("registers the browser worker on startup when autoRegister is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: async () => ({ agentId: 42 }),
    });
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    const client = createBrowserClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "michi-frontend",
      autoRegister: {
        appName: "michi",
        reportDiscoveredEvents: false,
      },
    });

    await expect(client.getRegistrationPromise()).resolves.toEqual({ success: true, agentId: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.logfriends.local/api/agents",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      workerId: "michi-frontend",
      appName: "michi",
      sourceType: "BROWSER",
    });

    await client.shutdown();
  });

  it("handles online recovery event by triggering flush", async () => {
    const client = createBrowserClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "browser-app-prod",
      flushIntervalMs: 0,
    });

    const flushSpy = vi.spyOn(client, "flush").mockResolvedValue({
      success: true,
      sentCount: 0,
      failedCount: 0,
    });

    // Trigger online event
    listeners["online"]?.forEach((fn) => fn());
    expect(flushSpy).toHaveBeenCalled();

    await client.shutdown();
  });

  it("triggers keepalive flush when visibilitychange becomes hidden or pagehide occurs", async () => {
    const client = createBrowserClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "browser-app-prod",
      flushIntervalMs: 0,
    });

    const flushSpy = vi.spyOn(client, "flush").mockResolvedValue({
      success: true,
      sentCount: 0,
      failedCount: 0,
    });

    // Trigger visibilitychange to hidden
    (document as { visibilityState: string }).visibilityState = "hidden";
    listeners["visibilitychange"]?.forEach((fn) => fn());
    expect(flushSpy).toHaveBeenCalledWith({ keepalive: true });

    // Trigger pagehide
    listeners["pagehide"]?.forEach((fn) => fn());
    expect(flushSpy).toHaveBeenCalledWith({ keepalive: true });

    await client.shutdown();
  });

  it("is completely SSR safe and does not crash when window/document are undefined", () => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;

    expect(() => {
      const client = createBrowserClient({
        ingestUrl: "https://console.logfriends.local/ingest",
        workerId: "browser-app-ssr",
      });
      client.track("serverEvent", { page: "/home" });
      client.identify("ssr-user");
    }).not.toThrow();
  });

  it("sends events immediately on client track() without queueing or waiting for timer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ received: 1, stored: 1, failed: 0 }),
    });
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    const client = createBrowserClient({
      ingestUrl: "https://console.logfriends.local/ingest",
      workerId: "browser-instant",
    });

    client.track("leadGenerated", { leadType: "demo_request" });

    // Wait a tick for async flush execution
    await new Promise((r) => setTimeout(r, 15));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArg = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callArg.events[0].eventName).toBe("leadGenerated");

    await client.shutdown();
  });
});
