const MAX_OBJECT_DEPTH = 8;
const CAMEL_CASE_REGEX = /^[a-z][a-zA-Z0-9]*$/;

const SENSITIVE_KEY_PATTERNS = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^e-?mail$/i,
  /^phone(number)?$/i,
  /^password$/i,
  /^secret$/i,
  /^threadsecret$/i,
  /^edit(token)?$/i,
  /^accesstoken$/i,
  /^refreshtoken$/i,
  /^token$/i,
  /^auth_token$/i,
  /^requesttext$/i,
  /^ssn$/i,
  /^creditcard$/i,
  /^cardnumber$/i,
  /^cvv$/i,
];

/**
 * Generates a standard UUID v4 string across Browser, Node, and Mobile runtimes.
 */
export function generateEventId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback RFC4122 version 4 UUID generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates that eventName adheres to camelCase convention.
 */
export function isValidEventName(eventName: string): boolean {
  return typeof eventName === "string" && eventName.length > 0 && CAMEL_CASE_REGEX.test(eventName);
}

/**
 * Checks if a key name corresponds to known sensitive credentials/PII.
 */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key) || pattern.test(normalized));
}

/**
 * Sanitizes arbitrary objects against circular references, excessive depth, sensitive credentials, and non-JSON values.
 */
export function sanitizePayload(
  raw: unknown,
  maxDepth = MAX_OBJECT_DEPTH,
): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object") {
    return { value: sanitizeValue(raw, new WeakSet(), 0, maxDepth) };
  }

  const seen = new WeakSet();
  const sanitized = sanitizeValue(raw, seen, 0, maxDepth);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return { value: sanitized };
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) {
    return "[Truncated: Max Depth Reached]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  const type = typeof value;

  if (type === "string" || type === "number" || type === "boolean") {
    return value;
  }

  if (type === "bigint") {
    return (value as bigint).toString();
  }

  if (type === "symbol" || type === "function") {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.slice(0, 1000) : undefined,
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const arrResult: unknown[] = [];
      for (const item of value) {
        const sanitizedItem = sanitizeValue(item, seen, depth + 1, maxDepth);
        if (sanitizedItem !== undefined) {
          arrResult.push(sanitizedItem);
        }
      }
      return arrResult;
    }

    if (value instanceof Map) {
      const mapObj: Record<string, unknown> = {};
      for (const [k, v] of value.entries()) {
        const keyStr = String(k);
        if (isSensitiveKey(keyStr)) {
          mapObj[keyStr] = "[REDACTED]";
        } else {
          const sanitizedVal = sanitizeValue(v, seen, depth + 1, maxDepth);
          if (sanitizedVal !== undefined) {
            mapObj[keyStr] = sanitizedVal;
          }
        }
      }
      return mapObj;
    }

    if (value instanceof Set) {
      const setResult: unknown[] = [];
      for (const item of value.values()) {
        const sanitizedItem = sanitizeValue(item, seen, depth + 1, maxDepth);
        if (sanitizedItem !== undefined) {
          setResult.push(sanitizedItem);
        }
      }
      return setResult;
    }

    const objResult: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      // Protect prototype pollution
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;

      if (isSensitiveKey(key)) {
        objResult[key] = "[REDACTED]";
        continue;
      }

      const propVal = (value as Record<string, unknown>)[key];
      const sanitizedVal = sanitizeValue(propVal, seen, depth + 1, maxDepth);
      if (sanitizedVal !== undefined) {
        objResult[key] = sanitizedVal;
      }
    }
    return objResult;
  }

  return "[Unsupported value]";
}

/**
 * Calculates UTF-8 byte length for any string across all runtimes (Browser, Node, React Native/Hermes).
 */
export function utf8ByteLength(str: string): number {
  if (typeof str !== "string" || str.length === 0) return 0;

  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str).length;
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.byteLength(str, "utf8");
  }

  // Pure JavaScript UTF-8 byte calculation fallback (Hermes / legacy webviews)
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair
      i++;
      bytes += 4;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Calculates byte size of a string (UTF-8) or JSON representation.
 */
export function estimateByteSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    return utf8ByteLength(json);
  } catch {
    return 0;
  }
}
