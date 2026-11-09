# Log Friends TypeScript SDK

> **개발 구현 기준 문서:** 최신 로컬 코드의 사용법을 설명합니다. 이 README 전용 PR에는 제품 코드·배포 변경이 포함되지 않습니다. GitHub 기본 브랜치만 clone한 경우 아래 기능·명령이 아직 일치하지 않을 수 있으며, 관련 코드 반영 후 사용해야 합니다.

웹 브라우저와 Node.js 백엔드에서 명시적으로 기록한 비즈니스 이벤트를
`LOG_EVENT` JSON 배치로 전송하는 SDK입니다. JVM SDK의 ByteBuddy 자동 계측을 제공하지 않습니다.

**현재 코드에는 최신 Console의 앱 키 인증 연동이 빠져 있습니다.**
클라이언트 생성과 배치 전송 구현이 있다는 것과 현재 Console에 연결할 수 있다는 것은 다릅니다.

## 저장소와 지원 범위

| 항목 | 현재 코드 기준 |
|---|---|
| 패키지 | `@logfriends/sdk`, `package.json` 버전 `1.0.12` |
| Node.js | 18 이상, `@logfriends/sdk/node` |
| 웹 브라우저 | `@logfriends/sdk/browser`, 세션·페이지 정보 및 수동 컴포넌트 위치 |
| 모바일 | 지원 범위 밖. 소스만 보존하며 공개 export·빌드·패키징·lint·지원 테스트에서 제외 |
| 모듈 형식 | ESM / CommonJS 및 타입 선언 생성 |

이 작업 트리에는 Agent 등록 도우미, Browser `uiContext`, Node 환경변수 설정과
선택적 힙 가드가 있습니다. 이전 `log-friends-sdk-ts` 작업 트리는 패키지 버전이
`1.0.4`이며 이 기능들이 동일하게 구현되어 있지 않습니다.

버전은 로컬 코드의 값입니다. npm 공개 발행 여부와 설치 가능한 버전은 확인하지 않았습니다.
`publishConfig.access: "public"` 설정만으로 발행을 보장하지 않습니다.

## Console 연동의 현재 한계

- 현재 Console은 ingest·Agent 등록·이벤트 정의 보고에 `X-LogFriends-App-Key` 인증을 확인합니다.
  이 SDK의 기본 전송과 등록·보고 요청은 해당 헤더를 보내지 않습니다.
- `LOGFRIENDS_APP_KEY`를 통한 `GET /api/sdk/config` 설정 조회, 주기적 heartbeat,
  수집 정책 조회·적용·ACK가 구현되어 있지 않습니다. JVM SDK와 같은 시작·운영 경로가 아닙니다.
- `registerAgent`는 등록 요청 도우미일 뿐 인증을 해결하지 않습니다.
  Browser의 `autoRegister`도 기본 비활성화이며 현재 연결 절차로 권장하지 않습니다.
- 서버 앱 비밀키를 브라우저 번들에 넣어 우회하지 마세요. CORS 허용만으로 인증 공백이 해결되지 않습니다.

따라서 아래 예제는 **API 사용 형태**입니다. 최신 Console에 바로 연결되는 완료 예제가 아닙니다.

## API 예제

공개 패키지가 해당 버전으로 제공되는지 확인한 뒤 설치합니다.

```bash
npm install @logfriends/sdk
npm ls @logfriends/sdk
```

### Node.js

다음 ESM 예제의 주소는 테스트 수신기용 자리표시자입니다.

```typescript
import { createNodeClient } from "@logfriends/sdk/node";

const client = createNodeClient({
  ingestUrl: "http://localhost:4318/ingest",
  workerId: "product-api-local-1",
  batchSize: 20,
  autoHookProcessSignals: false,
});

try {
  const accepted = client.track("productViewed", { productId: "PRD-001" });
  console.log({ accepted, result: await client.flush() });
} finally {
  await client.shutdown();
}
```

`4318`은 Console 기본 포트가 아닙니다. 별도의 테스트 수신기가 필요합니다.
`track()`의 반환값은 큐 적재 여부이며 Console DB 저장 완료가 아닙니다.
종료 처리를 앱에서 맡으면 위처럼 자동 프로세스 훅을 끄고 `shutdown()`을 호출합니다.

### 웹 브라우저

```typescript
import { createBrowserClient } from "@logfriends/sdk/browser";

const client = createBrowserClient({
  ingestUrl: "https://collector.example.test/ingest",
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

주소는 자리표시자입니다. 브라우저 접근을 허용하는 수신 경로가 별도로 필요합니다.
현재 페이지 경로·쿼리·해시는 자동으로 붙고, 컴포넌트 위치는 직접 지정합니다.
URL에도 개인정보나 토큰을 넣지 마세요. 앱 해제 시 `client.shutdown()`으로 리스너를 정리합니다.

## 배치와 데이터 주의사항

| 설정 | 기본값 |
|---|---|
| `batchSize` / `flushIntervalMs` | 20건 / 5초 |
| `maxQueueSize` / `maxQueueBytes` | 1,000건 / 2MiB |
| `maxEventBytes` / `maxBatchBytes` | 32KiB / 256KiB |
| `queueOverflowPolicy` / `maxRetries` | `DROP_OLDEST` / 3회 |

Browser는 기본적으로 적재 후 즉시 flush를 시도합니다.
현재 Console의 요청당 이벤트 상한은 50건이므로 연결을 구현할 때도 `batchSize <= 50`을 유지해야 합니다.
메모리 큐는 초과·전송 실패·강제 종료로 유실될 수 있고, 페이지 종료 시 `sendBeacon`도 DB 저장을 보장하지 않습니다.

Node에서는 유효한 다음 환경변수 값이 생성자 설정보다 우선합니다:
`LOGFRIENDS_INGEST_URL`, `LOGFRIENDS_WORKER_ID`, `LOGFRIENDS_BATCH_SIZE`,
`LOGFRIENDS_BATCH_INTERVAL_MS`, `LOGFRIENDS_QUEUE_CAPACITY`,
`LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES`. 이는 현재 JVM SDK의 앱 키 설정 방식과 다릅니다.

`getStats()`의 바이트 값은 직렬화된 UTF-8 기준이며 실제 힙 점유량이 아닙니다.
Node의 `heapGuard`는 별도 선택 옵션이며 `getHeapPressure()`로 관측합니다.
개인정보와 비밀 값은 수집 전에 제거하세요.

## 이벤트 정의와 코드 안내

- [decorators](src/decorators/index.ts): `LogEvent`, `LogField`로 메서드·필드 메타데이터 선언.
- [schema](src/schema/index.ts): `defineEvent`로 타입이 있는 이벤트 정의. 서버 payload 검증을 대신하지 않습니다.
- [discovery](src/discovery/index.ts): `registerAgent`, `reportDiscoveredEvents`.
  정의 보고에는 등록 응답의 `agentId`가 필요하며, 보고된 후보가 LogSpec으로 자동 확정되지는 않습니다.

설정은 [공통 타입](src/core/types.ts), [Node 클라이언트](src/node/node-client.ts),
[Browser 클라이언트](src/browser/browser-client.ts), 공개 경로는 [package.json](package.json)을 참고하세요.
`../docs/sdk/supported-runtimes.md`는 상위 통합 작업공간의 **로컬 전용 문서**이며 이 GitHub 저장소에는 포함되지 않습니다.

## 로컬 개발

```bash
npm ci
npm run lint
npm test
npm run build
npm run verify-pack
```

`build`는 ESM·CommonJS를 생성하고, `verify-pack`은 로컬 산출물·일부 export를 검사합니다.
Console 실연동, npm 공개 발행, 운영 배포를 확인하는 명령은 아닙니다.

[Apache-2.0](LICENSE)
