import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LogEvent,
  setGlobalClient,
} from "../../src/decorators/log-event.js";
import { LogField, LogMasked } from "../../src/decorators/log-field.js";
import { discoveredEventRegistry } from "../../src/discovery/event-discovery.js";
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

describe("@LogField & @LogMasked Parameter Decorators", () => {
  let client: TestClient;

  beforeEach(() => {
    client = new TestClient();
    setGlobalClient(client);
    discoveredEventRegistry.clear();
  });

  afterEach(() => {
    setGlobalClient(null);
  });

  it("maps parameter names and masks sensitive parameters decorated with @LogMasked", async () => {
    class PaymentService {
      @LogEvent("paymentSubmitted")
      async submitPayment(
        @LogField({ name: "orderId", description: "주문 고유 식별자", type: "string" })
        orderId: string,
        @LogField({ name: "amount", description: "최종 실결제 금액 (KRW)", type: "number" })
        amount: number,
        @LogMasked("pinCode")
        pinCode: string,
      ) {
        return { orderId, amount, pinCode };
      }
    }

    const service = new PaymentService();
    await service.submitPayment("ORD-8899", 59000, "9876");

    expect(client.trackedEvents).toHaveLength(1);
    const event = client.trackedEvents[0];
    expect(event.eventName).toBe("paymentSubmitted");
    expect(event.payload?.orderId).toBe("ORD-8899");
    expect(event.payload?.amount).toBe(59000);
    expect(event.payload?.pinCode).toBe("[REDACTED]");
  });

  it("records discovered event metadata in DiscoveredEventRegistry", () => {
    class InventoryService {
      @LogEvent({
        name: "stockDecreased",
        description: "주문으로 인한 재고 차감 이벤트",
      })
      updateStock(
        @LogField({ name: "itemId", description: "상품 고유 코드", required: true })
        itemId: string,
        @LogField({ name: "quantity", description: "차감 수량", type: "number" })
        quantity: number,
      ) {
        return { itemId, quantity };
      }
    }

    // Instantiating triggers class definition
    new InventoryService();

    const discovered = discoveredEventRegistry.getAll();
    const event = discovered.find((e) => e.eventName === "stockDecreased");

    expect(event).toBeDefined();
    expect(event?.sourceClass).toBe("InventoryService");
    expect(event?.sourceMethod).toBe("updateStock");
    expect(event?.specHint?.description).toBe("주문으로 인한 재고 차감 이벤트");

    const fields = event?.specHint?.fields;
    expect(fields).toHaveLength(2);
    expect(fields?.[0]).toEqual({
      name: "itemId",
      description: "상품 고유 코드",
      type: undefined,
      required: true,
      example: undefined,
    });
    expect(fields?.[1]).toEqual({
      name: "quantity",
      description: "차감 수량",
      type: "number",
      required: true,
      example: undefined,
    });
  });
});
