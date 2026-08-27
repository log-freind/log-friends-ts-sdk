import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  sanitizePayload,
  utf8ByteLength,
} from "../../src/core/event-sanitizer.js";
import { BaseLogFriendsClient } from "../../src/core/base-client.js";
import type { IngestRequest, IngestResponse, TransportSender } from "../../src/core/types.js";

class DummyClient extends BaseLogFriendsClient {
  protected override resolveSessionId(): string {
    return "dummy-session";
  }
  protected override resolveAppInstanceId(): undefined {
    return undefined;
  }
}

describe("sanitizer-pii-credentials", () => {
  it("masks sensitive keys including passwords, authorization tokens, cookies and cards", () => {
    expect(isSensitiveKey("authorization")).toBe(true);
    expect(isSensitiveKey("Authorization")).toBe(true);
    expect(isSensitiveKey("cookie")).toBe(true);
    expect(isSensitiveKey("set-cookie")).toBe(true);
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("secret")).toBe(true);
    expect(isSensitiveKey("accessToken")).toBe(true);
    expect(isSensitiveKey("refresh_token")).toBe(true);
    expect(isSensitiveKey("creditCard")).toBe(true);

    expect(isSensitiveKey("userName")).toBe(false);
    expect(isSensitiveKey("orderId")).toBe(false);
    expect(isSensitiveKey("productId")).toBe(false);

    const raw = {
      orderId: "ord-12345",
      password: "SuperSecretPassword123!",
      authorization: "Bearer eyJhbGciOi...",
      cookie: "SESSION=abcde",
      details: {
        accessToken: "tok_secret_999",
        safeNote: "Please deliver to porch",
      },
    };

    const sanitized = sanitizePayload(raw) as Record<string, unknown>;
    expect(sanitized.orderId).toBe("ord-12345");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.cookie).toBe("[REDACTED]");
    expect((sanitized.details as Record<string, unknown>).accessToken).toBe("[REDACTED]");
    expect((sanitized.details as Record<string, unknown>).safeNote).toBe("Please deliver to porch");
  });

  it("calculates UTF-8 byte length correctly with pure JS fallback without TextEncoder or Buffer", () => {
    // 1-byte ASCII
    expect(utf8ByteLength("hello")).toBe(5);
    // 3-byte Hangul: '한글' = 6 bytes
    expect(utf8ByteLength("한글")).toBe(6);
    // 4-byte Emoji: '🚀' = 4 bytes
    expect(utf8ByteLength("🚀")).toBe(4);
    // Combined string
    expect(utf8ByteLength("LogFriends 로그 🚀")).toBe(10 + 1 + 6 + 1 + 4);
  });

  it("resets user identity state on resetIdentity() without rotating session", () => {
    const mockSender: TransportSender = {
      send: async (_url: string, body: IngestRequest): Promise<IngestResponse> => ({
        received: body.events.length,
        stored: body.events.length,
        failed: 0,
      }),
    };

    const client = new DummyClient(
      {
        ingestUrl: "http://localhost:8080/ingest",
        workerId: "dummy-worker",
        sourceType: "NODE",
        flushIntervalMs: 0,
      },
      mockSender,
    );

    client.identify("user-alpha-99", { role: "admin", email: "admin@example.com" });
    const id1 = client.getIdentity();
    expect(id1.userId).toBe("user-alpha-99");
    expect(id1.traits.role).toBe("admin");

    client.resetIdentity();
    const id2 = client.getIdentity();
    expect(id2.userId).toBeNull();
    expect(Object.keys(id2.traits)).toHaveLength(0);
  });
});
