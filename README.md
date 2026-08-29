# @logfriends/sdk

Log Friends Multi-Runtime TypeScript Client SDK for **Browser**, **Mobile App**, and **Node.js**.

## Overview

- **Lightweight & Zero-Dependency**: Works seamlessly across browsers, React Native/Flutter/iOS/Android webviews, and Node.js backend runtimes.
- **Kotlin-Aligned `@LogEvent` & `@LogField`**: Method and parameter decorators with automatic purpose/description metadata and `[REDACTED]` masking.
- **Client Schema Definition (`defineEvent`)**: Type-safe event schemas with parameter descriptions and IDE hover tooltips for React/Next.js/React Native.
- **Log Catalog & Schema Reporting (`reportDiscoveredEvents`)**: Automatic schema reporting to Log Friends Console (`/api/agents/{agentId}/discovered-log-events`).
- **Fail-Safe Operation**: SDK errors or network degradation never block or crash host application execution.
- **Session & Inactivity Lifecycle**:
  - **Browser**: Tab-persistent session storage with automatic 30-minute inactivity rotation and `pagehide`/`visibilitychange` keepalive flush.
  - **Mobile**: Separation between persistent `appInstanceId` and execution `sessionId`, foreground/background flush adapters.
  - **Node.js**: Process signal hooks (`SIGTERM`, `SIGINT`, `beforeExit`) with bounded shutdown flush.
- **Bounded Queue & Protection**: Circular reference protection, depth limits, payload size limits, `DROP_OLDEST` / `DROP_NEWEST` overflow policies.

## Installation

```bash
npm install @logfriends/sdk
```

---

## 1. Backend / Class Services (`@LogEvent`, `@LogField`, `@LogMasked`)

```typescript
import {
  createNodeClient,
  setGlobalClient,
  reportDiscoveredEvents,
  LogEvent,
  LogField,
  LogMasked,
} from "@logfriends/sdk";

// 1. Initialize client & report discovered event schemas at server startup
const logfriends = createNodeClient({
  ingestUrl: "http://localhost:8080/ingest",
  workerId: "order-service",
});
setGlobalClient(logfriends);

// Automatically sends all @LogEvent and parameter descriptions to Log Friends Console!
await reportDiscoveredEvents(logfriends);

// 2. Decorate class service methods and parameters
export class OrderService {
  @LogEvent({
    name: "orderCreated",
    description: "사용자가 장바구니에서 결제를 완료했을 때 발생하는 비즈니스 이벤트",
    includeResult: true,
  })
  async createOrder(
    @LogField({ name: "orderId", description: "주문 고유 식별자", required: true })
    orderId: string,

    @LogField({ name: "amount", description: "최종 실결제 금액 (KRW)", type: "number" })
    amount: number,

    @LogMasked("secretPin")
    secretPin: string,
  ) {
    // Business logic...
    return { orderId, status: "PAID" };
  }
}
```

---

## 2. Frontend / Client Runtime (`defineEvent`, `trackEvent`)

```tsx
import { createBrowserClient, defineEvent, trackEvent } from "@logfriends/sdk";

// 1. Declare event schema with parameter descriptions (purpose)
export const ShopEvents = {
  orderCompleted: defineEvent<{
    orderId: string;
    amount: number;
    couponCode?: string;
  }>({
    name: "orderCompleted",
    description: "사용자가 장바구니에서 최종 결제를 성공했을 때 발생",
    fields: {
      orderId: { description: "주문 고유 식별자", type: "string", required: true },
      amount: { description: "최종 실결제 금액 (KRW)", type: "number", required: true },
      couponCode: { description: "적용된 프로모션 쿠폰", type: "string", required: false },
    },
  }),
};

// 2. Initialize client
const logfriends = createBrowserClient({
  ingestUrl: "https://console.logfriends.local/ingest",
  workerId: "shop-frontend",
});

// 3. Track events type-safely in React components / handlers
function CheckoutButton({ orderId, total }) {
  return (
    <button
      onClick={() => {
        // 💡 Hover over each field in IDE to view parameter purpose & description
        trackEvent(logfriends, ShopEvents.orderCompleted, {
          orderId,
          amount: total,
          couponCode: "WELCOME2026",
        });
      }}
    >
      결제하기
    </button>
  );
}
```

---

## 3. Mobile App Runtime (React Native, Capacitor, etc.)

```typescript
import { createMobileClient } from "@logfriends/sdk/mobile";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

const logfriends = createMobileClient({
  ingestUrl: "https://console.logfriends.local/ingest",
  workerId: "mobile-ios-prod",
  storageAdapter: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, val) => AsyncStorage.setItem(key, val),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
  lifecycleAdapter: {
    onForeground: (cb) => {
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") cb();
      });
      return () => sub.remove();
    },
  },
});

logfriends.track("itemFavorited", { itemId: "item-77" });
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE).
