import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LogEvent,
  getGlobalClient,
  setGlobalClient,
} from "../../src/decorators/log-event.js";
import { BaseLogFriendsClient } from "../../src/core/base-client.js";
import type { IngestRequest, IngestResponse, TransportSender } from "../../src/core/types.js";

class TestClient extends BaseLogFriendsClient {
  public trackedEvents: Array<{ eventName: string; payload?: Record<string, unknown> }> = [];

  constructor() {
    const mockSender: TransportSender = {
      send: async (_url: string, body: IngestRequest): Promise<IngestResponse> => ({
        received: body.events.length,
        stored: body.events.length,
        failed: 0,
      }),
    };
    super(
      {
        ingestUrl: "http://localhost:8080/ingest",
        workerId: "test-worker",
        sourceType: "NODE",
        flushIntervalMs: 0,
      },
      mockSender,
    );
  }

  public override track(
    eventName: string,
    payload?: Record<string, unknown>,
  ): boolean {
    this.trackedEvents.push({ eventName, payload });
    return super.track(eventName, payload);
  }

  protected override resolveSessionId(): string | undefined {
    return "test-session";
  }

  protected override resolveAppInstanceId(): string | undefined {
    return undefined;
  }
}

describe("@LogEvent Decorator", () => {
  let client: TestClient;

  beforeEach(() => {
    client = new TestClient();
    setGlobalClient(client);
  });

  afterEach(() => {
    setGlobalClient(null);
  });

  it("manages global client registration via setGlobalClient and getGlobalClient", () => {
    expect(getGlobalClient()).toBe(client);
    setGlobalClient(null);
    expect(getGlobalClient()).toBeNull();
  });

  it("intercepts async method execution and tracks event with execution duration and args", async () => {
    class OrderService {
      @LogEvent("orderCreated")
      async createOrder(orderId: string, amount: number) {
        await new Promise((r) => setTimeout(r, 20));
        return { success: true, orderId, total: amount };
      }
    }

    const service = new OrderService();
    const result = await service.createOrder("ord-1001", 35000);

    expect(result).toEqual({ success: true, orderId: "ord-1001", total: 35000 });
    expect(client.trackedEvents).toHaveLength(1);

    const event = client.trackedEvents[0];
    expect(event.eventName).toBe("orderCreated");
    expect(event.payload).toBeDefined();
    expect(event.payload?.arg0).toBe("ord-1001");
    expect(event.payload?.arg1).toBe(35000);
    expect(typeof event.payload?._durationMs).toBe("number");
    expect((event.payload?._durationMs as number)).toBeGreaterThanOrEqual(15);
  });

  it("maps positional arguments to custom parameter names when paramNames is provided", async () => {
    class UserService {
      @LogEvent({
        name: "userRegistered",
        paramNames: ["userId", "email", "plan"],
      })
      async registerUser(userId: string, email: string, plan: string) {
        return { userId, email, plan, status: "ACTIVE" };
      }
    }

    const service = new UserService();
    await service.registerUser("user-777", "test@example.com", "pro");

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.eventName).toBe("userRegistered");
    expect(event.payload?.userId).toBe("user-777");
    expect(event.payload?.email).toBe("[REDACTED]");
    expect(event.payload?.plan).toBe("pro");
  });

  it("flattens single DTO object argument directly into event payload", async () => {
    class CatalogService {
      @LogEvent("productViewed")
      viewProduct(dto: { productId: string; category: string; price: number }) {
        return dto.productId;
      }
    }

    const service = new CatalogService();
    service.viewProduct({ productId: "prod-99", category: "shoes", price: 89000 });

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.eventName).toBe("productViewed");
    expect(event.payload?.productId).toBe("prod-99");
    expect(event.payload?.category).toBe("shoes");
    expect(event.payload?.price).toBe(89000);
  });

  it("includes return value in payload when includeResult is true", async () => {
    class PaymentService {
      @LogEvent({
        name: "paymentCompleted",
        includeResult: true,
      })
      async processPayment(amount: number) {
        return { txId: "tx-9999", amount, confirmed: true };
      }
    }

    const service = new PaymentService();
    await service.processPayment(50000);

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.payload?._result).toEqual({ txId: "tx-9999", amount: 50000, confirmed: true });
  });

  it("captures async error and rethrows original exception unchanged", async () => {
    class FailingService {
      @LogEvent("transferAttempted")
      async transferMoney(amount: number) {
        if (amount > 1000) {
          throw new Error("Insufficient funds for transfer");
        }
        return true;
      }
    }

    const service = new FailingService();
    await expect(service.transferMoney(5000)).rejects.toThrow("Insufficient funds for transfer");

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.eventName).toBe("transferAttempted");
    expect(event.payload?._error).toEqual({
      message: "Insufficient funds for transfer",
      name: "Error",
    });
    expect(typeof event.payload?._durationMs).toBe("number");
  });

  it("supports custom payload mapper functions", async () => {
    class CustomService {
      @LogEvent({
        name: "customEvent",
        payload: (args, result) => ({
          firstArg: args[0],
          returnedCount: (result as string[]).length,
          source: "custom-builder",
        }),
      })
      async search(query: string) {
        return [query, "item2", "item3"];
      }
    }

    const service = new CustomService();
    await service.search("shoes");

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.payload?.firstArg).toBe("shoes");
    expect(event.payload?.returnedCount).toBe(3);
    expect(event.payload?.source).toBe("custom-builder");
  });

  it("falls back to method name in camelCase when event name is omitted", async () => {
    class InvoiceService {
      @LogEvent()
      generateInvoice(invoiceId: string) {
        return invoiceId;
      }
    }

    const service = new InvoiceService();
    service.generateInvoice("inv-500");

    expect(client.trackedEvents).toHaveLength(1);
    expect(client.trackedEvents[0].eventName).toBe("generateInvoice");
  });

  it("automatically masks sensitive credentials and passwords in arguments", async () => {
    class AuthService {
      @LogEvent("loginAttempted")
      async login(credentials: { username: string; password: string; accessToken: string }) {
        return { ok: true, user: credentials.username };
      }
    }

    const service = new AuthService();
    await service.login({
      username: "john_doe",
      password: "SuperSecretPassword!",
      accessToken: "eyJhbGciOi...",
    });

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.payload?.username).toBe("john_doe");
    expect(event.payload?.password).toBe("[REDACTED]");
    expect(event.payload?.accessToken).toBe("[REDACTED]");
  });

  it("allows overriding specific client instance per decorator", async () => {
    const customScopedClient = new TestClient();

    class ScopedService {
      @LogEvent({
        name: "scopedAction",
        client: customScopedClient,
      })
      run() {
        return 42;
      }
    }

    const service = new ScopedService();
    service.run();

    expect(customScopedClient.trackedEvents).toHaveLength(1);
    expect(client.trackedEvents).toHaveLength(0); // Global client not touched
  });
});
