import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineEvent, exportEventCatalog, trackEvent } from "../../src/schema/define-event.js";
import { reportDiscoveredEvents, discoveredEventRegistry } from "../../src/discovery/event-discovery.js";
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
        workerId: "frontend-app",
        sourceType: "BROWSER",
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
    return "browser-session";
  }

  protected override resolveAppInstanceId(): string | undefined {
    return undefined;
  }
}

describe("defineEvent & Event Discovery", () => {
  let client: TestClient;

  beforeEach(() => {
    client = new TestClient();
    discoveredEventRegistry.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defines client event schemas with field descriptions and tracks payload type-safely", () => {
    const OrderCompleted = defineEvent<{
      orderId: string;
      amount: number;
      couponCode?: string;
    }>({
      name: "orderCompleted",
      description: "사용자가 장바구니에서 결제를 성공했을 때 발생",
      fields: {
        orderId: { description: "주문 고유 식별자", type: "string", required: true },
        amount: { description: "최종 실결제 금액 (KRW)", type: "number", required: true },
        couponCode: { description: "적용된 쿠폰 코드", type: "string", required: false },
      },
    });

    expect(OrderCompleted.name).toBe("orderCompleted");
    expect(OrderCompleted.description).toBe("사용자가 장바구니에서 결제를 성공했을 때 발생");
    expect(OrderCompleted.fields.orderId.description).toBe("주문 고유 식별자");

    trackEvent(client, OrderCompleted, {
      orderId: "ord-9988",
      amount: 45000,
      couponCode: "WELCOME10",
    });

    expect(client.trackedEvents).toHaveLength(1);
    expect(client.trackedEvents[0]).toEqual({
      eventName: "orderCompleted",
      payload: {
        orderId: "ord-9988",
        amount: 45000,
        couponCode: "WELCOME10",
      },
    });
  });

  it("exports event catalog for Log Friends Console Log Catalog", () => {
    const ProductViewed = defineEvent<{ productId: string }>({
      name: "productViewed",
      description: "상품 상세 조회",
      fields: {
        productId: { description: "상품 식별자", type: "string" },
      },
    });

    const catalog = exportEventCatalog([ProductViewed]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].eventName).toBe("productViewed");
    expect(catalog[0].specHint?.fields[0]).toEqual({
      name: "productId",
      description: "상품 식별자",
      type: "string",
      required: true,
      example: undefined,
    });
  });

  it("reports discovered schemas to Log Friends Console endpoint", async () => {
    defineEvent<{ itemId: string }>({
      name: "itemAdded",
      description: "장바구니 담기",
      fields: {
        itemId: { description: "상품 아이디", type: "string" },
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await reportDiscoveredEvents(client, {
      appName: "shop-frontend",
      appVersion: "2.1.0",
      agentId: "42",
    });

    expect(result.success).toBe(true);
    expect(result.received).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, requestInit] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/agents/42/discovered-log-events");

    const body = JSON.parse(requestInit.body);
    expect(body.workerId).toBe("frontend-app");
    expect(body.appName).toBe("shop-frontend");
    expect(body.appVersion).toBe("2.1.0");
    expect(body.events[0].eventName).toBe("itemAdded");
    expect(body.events[0].specHint.description).toBe("장바구니 담기");
  });
});
