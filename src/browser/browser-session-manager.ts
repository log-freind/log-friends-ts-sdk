import { generateEventId } from "../core/event-sanitizer.js";

const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_STORAGE_KEY = "logfriends_session_id";
const LAST_ACTIVE_STORAGE_KEY = "logfriends_last_active_ts";

export interface BrowserSessionConfig {
  sessionTimeoutMs?: number;
  initialSessionId?: string;
}

export class BrowserSessionManager {
  private readonly sessionTimeoutMs: number;
  private inMemorySessionId: string | null = null;
  private inMemoryLastActiveTs = 0;

  constructor(config: BrowserSessionConfig = {}) {
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    if (config.initialSessionId) {
      this.inMemorySessionId = config.initialSessionId;
      this.inMemoryLastActiveTs = Date.now();
      this.saveToStorage(this.inMemorySessionId, this.inMemoryLastActiveTs);
    }
  }

  public getSessionId(): string {
    const now = Date.now();
    const stored = this.loadFromStorage();

    if (stored) {
      const isExpired = now - stored.lastActiveTs > this.sessionTimeoutMs;
      if (!isExpired) {
        this.updateLastActive(stored.sessionId, now);
        return stored.sessionId;
      }
    }

    // Generate new session ID (either fresh tab, expired, or first load)
    const newSessionId = generateEventId();
    this.updateLastActive(newSessionId, now);
    return newSessionId;
  }

  public resetSession(): string {
    const newSessionId = generateEventId();
    this.updateLastActive(newSessionId, Date.now());
    return newSessionId;
  }

  private updateLastActive(sessionId: string, timestamp: number): void {
    this.inMemorySessionId = sessionId;
    this.inMemoryLastActiveTs = timestamp;
    this.saveToStorage(sessionId, timestamp);
  }

  private loadFromStorage(): { sessionId: string; lastActiveTs: number } | null {
    if (!this.hasSessionStorage()) {
      if (this.inMemorySessionId) {
        return {
          sessionId: this.inMemorySessionId,
          lastActiveTs: this.inMemoryLastActiveTs,
        };
      }
      return null;
    }

    try {
      const sessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      const lastActiveRaw = window.sessionStorage.getItem(LAST_ACTIVE_STORAGE_KEY);
      if (!sessionId) return null;

      const lastActiveTs = lastActiveRaw ? Number(lastActiveRaw) : Date.now();
      return { sessionId, lastActiveTs };
    } catch {
      return this.inMemorySessionId
        ? { sessionId: this.inMemorySessionId, lastActiveTs: this.inMemoryLastActiveTs }
        : null;
    }
  }

  private saveToStorage(sessionId: string, timestamp: number): void {
    if (!this.hasSessionStorage()) return;

    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      window.sessionStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(timestamp));
    } catch {
      // Storage might be blocked or full
    }
  }

  private hasSessionStorage(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.sessionStorage !== "undefined"
    );
  }
}
