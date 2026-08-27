import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";

describe("browser-session-manager", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    // Simulate window.sessionStorage
    (globalThis as unknown as { window: { sessionStorage: Storage } }).window = {
      sessionStorage: {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, val: string) => {
          mockStorage[key] = val;
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
        key: (_i: number) => null,
        length: Object.keys(mockStorage).length,
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("persists sessionId across requests within active window", () => {
    const manager = new BrowserSessionManager({ sessionTimeoutMs: 1000 });
    const s1 = manager.getSessionId();
    expect(s1).toBeDefined();

    const s2 = manager.getSessionId();
    expect(s2).toBe(s1);
  });

  it("rotates sessionId when inactivity timeout is exceeded", async () => {
    const manager = new BrowserSessionManager({ sessionTimeoutMs: 50 });
    const s1 = manager.getSessionId();

    await new Promise((r) => setTimeout(r, 60));

    const s2 = manager.getSessionId();
    expect(s2).not.toBe(s1);
  });

  it("allows explicit manual session reset", () => {
    const manager = new BrowserSessionManager();
    const s1 = manager.getSessionId();
    const s2 = manager.resetSession();
    expect(s2).not.toBe(s1);
    expect(manager.getSessionId()).toBe(s2);
  });

  it("falls back gracefully in SSR environment without window", () => {
    delete (globalThis as { window?: unknown }).window;

    const manager = new BrowserSessionManager();
    const s1 = manager.getSessionId();
    const s2 = manager.getSessionId();
    expect(s1).toBe(s2);
  });
});
