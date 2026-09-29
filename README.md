# Log Friends TypeScript SDK

Node.js, 브라우저, JavaScript 모바일 앱에서 발생한 이벤트를 Console로 보내는 SDK입니다.
현재 저장소의 패키지 버전은 `@logfriends/sdk 1.0.12`입니다.

| 실행 환경 | 가져올 모듈 | 사용 예 |
|---|---|---|
| Node.js | `@logfriends/sdk/node` | 서버 이벤트 수집 |
| 브라우저 | `@logfriends/sdk/browser` | 사용자 행동과 페이지·컴포넌트 위치 수집 |
| JavaScript 모바일 | `@logfriends/sdk/mobile` | 앱 이벤트 수집, 저장소·생명주기 어댑터 연결 |

Swift, Kotlin, Dart용 네이티브 SDK는 아닙니다.
Spring Boot 서비스에는 [Kotlin SDK](https://github.com/log-freind/log-friends-kt-sdk)를 사용하세요.

## 설치

Node.js 모듈은 Node.js 18 이상을 요구합니다. 먼저 [Console](https://github.com/log-freind/log-friends-console)을 실행하세요.

```bash
npm install @logfriends/sdk
```

설치된 버전은 `npm ls @logfriends/sdk`로 확인할 수 있습니다.
저장소의 작업 내용과 npm에 배포된 버전은 다를 수 있습니다.

## Node.js에서 첫 이벤트 보내기

아래 코드는 ESM 모듈 기준입니다.

```typescript
import { createNodeClient } from "@logfriends/sdk/node";
import { registerAgent } from "@logfriends/sdk/discovery";

const client = createNodeClient({
  ingestUrl: "http://localhost:8080/ingest",
  workerId: "product-api-local-1",
  batchSize: 20,
});

try {
  const registration = await registerAgent(client, {
    appName: "product-api",
    sourceType: "NODE",
  });
  if (!registration.success) throw registration.error;

  client.track("productViewed", { productId: "PRD-001" });
  console.log(await client.flush());
} finally {
  await client.shutdown();
}
```

Console Web의 Raw Events에서 `productViewed`를 조회하세요.
`track()`의 반환값은 큐 적재 여부이며 DB 저장 성공을 뜻하지 않습니다.

Agent 등록은 앱과 worker를 Catalog에서 연결하기 위해 필요합니다.
코드 정의까지 보고하려면 데코레이터가 선언된 모듈을 먼저 로드한 뒤
`reportDiscoveredEvents(client, { appName, agentId })`를 호출합니다.
보고된 정의는 힌트이며 LogSpec으로 자동 확정되지 않습니다.

## 브라우저에서 사용하기

앱 초기화 시 클라이언트를 한 번 만들고 사용자 행동이 발생한 지점에서 호출하세요.

```typescript
import { createBrowserClient } from "@logfriends/sdk/browser";

const client = createBrowserClient({
  ingestUrl: "https://your-console.example/ingest",
  workerId: "shop-web",
});

function onProductClick(productId: string) {
  client.track("productClicked", { productId }, {
    uiContext: {
      component: "ProductCard",
      componentPath: ["ProductList", "ProductCard"],
    },
  });
}
```

`your-console.example`은 실제 Console 주소로 바꿔야 합니다.
현재 페이지 정보는 자동으로 붙지만 컴포넌트 위치는 위처럼 직접 지정합니다.
Console Web의 Frontend Tree는 이 정보를 사용합니다.

브라우저의 Agent 자동 등록은 기본 비활성화입니다. Catalog에 연결할 공통
`workerId`는 별도로 등록하고 사용자나 탭마다 Agent를 만들지 마세요.
Console CORS에 웹 앱의 origin을 허용해야 하며, HTTPS 페이지에서 HTTP Console을 호출하면 차단될 수 있습니다.

## 배치와 메모리 제한

| 설정 | 기본값 |
|---|---|
| `batchSize` / `flushIntervalMs` | 20건 / 5초 |
| `maxQueueSize` | 1,000건 |
| `maxQueueBytes` | 2MiB |
| `maxEventBytes` / `maxBatchBytes` | 32KiB / 256KiB |
| `queueOverflowPolicy` | `DROP_OLDEST` |
| `maxRetries` | 3회 |

브라우저와 모바일은 기본적으로 이벤트 적재 후 즉시 flush를 시도합니다.
**현재 Console은 HTTP 요청당 최대 50건**이므로 `batchSize`를 50보다 크게 지정하지 마세요.
Console 요청 제한에도 유의해야 합니다.

`maxQueueBytes`는 큐와 전송 중 이벤트의 **직렬화된 UTF-8 크기** 기준이지 실제 힙 점유량이 아닙니다.
Node.js는 `heapGuard: { maxHeapUsageRatio: 0.85 }`를 지정해 프로세스 전체 V8 힙 압력을 추가로 확인할 수 있습니다.

Node.js에서는 다음 환경변수가 생성자 설정보다 우선합니다:
`LOGFRIENDS_INGEST_URL`, `LOGFRIENDS_WORKER_ID`, `LOGFRIENDS_BATCH_SIZE`,
`LOGFRIENDS_BATCH_INTERVAL_MS`, `LOGFRIENDS_QUEUE_CAPACITY`, `LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES`.

## 주의할 점

- 이벤트는 메모리 큐에 보관합니다. 초과·전송 실패·강제 종료로 유실될 수 있어 결제 원장을 대체하지 않습니다.
- 페이지 종료 시 전송은 최선의 시도입니다. `sendBeacon` 성공도 DB 저장 완료가 아닙니다.
- 모바일 저장소 어댑터는 앱 인스턴스 ID 보관용이며 이벤트의 디스크 영속화를 제공하지 않습니다.
- `defineEvent`의 타입 선언은 서버가 payload를 런타임 검증한다는 뜻이 아닙니다.
- 개인정보나 토큰은 payload에 넣기 전에 제거하세요.

큐 상태는 `client.getStats()`, Node.js 힙 관측은 `client.getHeapPressure()`로 확인합니다.
상세 옵션은 [공통 타입](src/core/types.ts), [Node 클라이언트](src/node/node-client.ts),
[Browser 클라이언트](src/browser/browser-client.ts), [Mobile 클라이언트](src/mobile/mobile-client.ts)를 참고하세요.

## 개발

```bash
npm ci
npm run lint
npm test
npm run build
npm run verify-pack
```

[Console](https://github.com/log-freind/log-friends-console) ·
[Console Web](https://github.com/log-freind/log-friends-console-web) · [Apache-2.0](LICENSE)
