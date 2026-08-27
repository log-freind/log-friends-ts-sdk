# @logfriends/sdk

Log Friends Multi-Runtime TypeScript Client SDK for **Browser**, **Mobile App**, and **Node.js**.

## Overview

- **Lightweight & Zero-Dependency**: Works seamlessly across browsers, React Native/Flutter/iOS/Android webviews, and Node.js backend runtimes.
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

## Quick Start

### 1. Browser Runtime

```typescript
import { createBrowserClient } from "@logfriends/sdk/browser";

const logfriends = createBrowserClient({
  ingestUrl: "https://console.logfriends.local/ingest",
  workerId: "web-client-prod", // Fixed registered agent workerId
  batchSize: 20,
  flushIntervalMs: 5000,
});

// Identify user when logged in
logfriends.identify("user-12345", { plan: "enterprise" });

// Track client events (eventName must be camelCase)
logfriends.track("productViewed", {
  productId: "prod-998",
  category: "fashion",
  price: 49000,
});
```

### 2. Mobile App Runtime (React Native, Capacitor, etc.)

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

### 3. Node.js Runtime

```typescript
import { createNodeClient } from "@logfriends/sdk/node";

const logfriends = createNodeClient({
  ingestUrl: "http://localhost:8080/ingest",
  workerId: "payment-service",
});

logfriends.track("paymentProcessed", {
  transactionId: "tx-5510",
  amount: 150000,
  currency: "KRW",
});
```

## License

Apache License 2.0. See [LICENSE](./LICENSE).
