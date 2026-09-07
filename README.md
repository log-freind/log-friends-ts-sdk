# @logfriends/sdk

Log Friends Multi-Runtime TypeScript Client SDK for **Browser**, **Mobile App**, and **Node.js**.

## Overview

- **Lightweight & Zero-Dependency**: Works seamlessly across browsers, React Native/Flutter/iOS/Android webviews, and Node.js backend runtimes.
- **Kotlin-Aligned `@LogEvent` & `@LogField`**: Method and parameter decorators with automatic purpose/description metadata and `[REDACTED]` masking.
- **Client Schema Definition (`defineEvent`)**: Type-safe event schemas with parameter descriptions and IDE hover tooltips for React/Next.js/React Native.
- **Log Catalog & Schema Reporting**: Explicit Agent registration followed by `reportDiscoveredEvents()` to Console (`/api/agents/{agentId}/discovered-log-events`).
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
import { createNodeClient } from "@logfriends/sdk/node";
import { setGlobalClient, LogEvent, LogField, LogMasked } from "@logfriends/sdk/decorators";
import { registerAgent, reportDiscoveredEvents } from "@logfriends/sdk/discovery";

// 1. Initialize one server client
const logfriends = createNodeClient({
  ingestUrl: "http://localhost:8080/ingest",
  workerId: "order-service",
});
setGlobalClient(logfriends);

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

// 3. After decorated modules have been imported, register/refresh the Agent and report schemas.
const registration = await registerAgent(logfriends, {
  appName: "shop",
  appVersion: "1.0.0",
  sourceType: "NODE",
});

if (registration.success && registration.agentId !== undefined) {
  await reportDiscoveredEvents(logfriends, {
    appName: "shop",
    appVersion: "1.0.0",
    agentId: registration.agentId,
  });
}
```

---

## 2. Frontend / Client Runtime (`defineEvent`, `trackEvent`)

```tsx
import { createBrowserClient } from "@logfriends/sdk/browser";
import { defineEvent, trackEvent } from "@logfriends/sdk/schema";

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
  // Compatibility field: use one stable logical source ID, never a user/tab ID.
  workerId: "shop-web",
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
        }, {
          // page is automatic in Browser; this makes the Console tree explicit.
          uiContext: { componentPath: ["CheckoutForm", "CheckoutButton"] },
        });
      }}
    >
      결제하기
    </button>
  );
}
```

Browser events automatically carry the current `page` path. Pass `uiContext.componentPath`
from the page component to the emitting component when you want Console to group events as a
Frontend Tree. This context is stored separately from the event payload and does not become a
Log Catalog field.

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

## Queue 메모리 경계와 Node V8 보호

모든 런타임에서 SDK는 이벤트를 JSON으로 직렬화했을 때의 UTF-8 byte 크기를 기준으로
Queue를 제한한다. 이 값은 V8/JVM의 실제 객체 heap 크기가 아니라, Browser·Node·Mobile에
공통으로 적용할 수 있는 payload 예산이다.

| 설정 | 기본값 | 의미 |
|---|---:|---|
| `maxQueueSize` | 1,000 | Queue 이벤트 개수 상한 |
| `maxQueueBytes` | 2 MiB | Queue와 HTTP 전송 중 batch를 합친 UTF-8 payload 예산 |
| `maxEventBytes` | 32 KiB | 이벤트 하나의 최대 UTF-8 payload 크기 |
| `maxBatchBytes` | 256 KiB | HTTP batch 하나의 최대 UTF-8 payload 크기 |

batch를 Queue에서 꺼낸 뒤에도 HTTP 전송과 재시도가 끝날 때까지 해당 byte 예산은
`inFlightBytes`로 예약된다. 따라서 느린 Console 전송 때문에 Queue와 전송 중 batch가
합쳐져 예산을 넘는 것을 막는다.

Node 서버에서는 선택적으로 V8 전체 heap 압력도 2차 차단선으로 쓸 수 있다.

```ts
const logfriends = createNodeClient({
  ingestUrl: "http://localhost:8080/ingest",
  workerId: "order-service",
  heapGuard: {
    maxHeapUsageRatio: 0.85,
    checkIntervalMs: 1_000,
  },
});
```

`heapGuard`는 설정한 경우에만 동작한다. Node의 `used_heap_size / heap_size_limit`이
상한 이상이면 새 Log Friends 이벤트를 drop한다. V8 조회는 매 이벤트가 아니라 기본
1초마다 한 번만 갱신한다.

Node 배포에서는 Kotlin SDK와 같은 환경 변수로 batch 시간·개수·byte 예산을 설정할 수
있다. 환경 변수가 생성자 옵션보다 우선한다.

```bash
export LOGFRIENDS_INGEST_URL=https://console.example.com/ingest
export LOGFRIENDS_WORKER_ID=order-service-1
export LOGFRIENDS_BATCH_SIZE=100
export LOGFRIENDS_BATCH_INTERVAL_MS=500
export LOGFRIENDS_QUEUE_CAPACITY=10000
export LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES=33554432
```

`LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES`는 실제 V8 객체 heap 크기가 아니라, Queue와
in-flight batch에 보유한 UTF-8 JSON payload byte 예산이다. Browser/Mobile SDK는
`process.env`를 읽지 않으므로 동일한 값을 생성자 옵션으로 넘긴다.

```ts
const stats = logfriends.getStats();

console.log(stats.queuedBytes);
console.log(stats.inFlightBytes);
console.log(stats.retainedBytes);
console.log(stats.maxQueueBytes);
console.log(logfriends.getHeapPressure());
```

`retainedBytes`는 SDK가 관리하는 UTF-8 payload 예산이고, `getHeapPressure()`는 Node
프로세스 전체의 V8 heap 상태다. 두 값을 같은 실제 객체 heap 크기로 해석하면 안 된다.

### Node V8 heap 탐색 진단

개발 환경에서 아래 테스트를 실행하면 Queue 적재 전·후 V8 heap snapshot을 임시 폴더에
쓴다. Snapshot에는 `LogFriendsQueueEntry`라는 이름의 객체가 남아 Chrome DevTools의
Memory 탭에서 Queue entry와 retaining path를 탐색할 수 있다. 테스트 출력은
`queueReachableShallowBytes`와 SDK의 `estimatedPayloadBytes`도 함께 보여 주므로, 특정
payload에서 추정 예산이 실제 V8 그래프 대비 얼마나 보수적인지 비교할 수 있다.

```bash
LOGFRIENDS_HEAP_DIAGNOSTIC=true \
  npx vitest run test/node/node-heap-diagnostic.test.ts --reporter=verbose
```

이 진단은 snapshot 생성과 JSON 분석 때문에 무겁다. 운영 요청 경로나 일반 테스트에는
실행하지 않는다.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE).
