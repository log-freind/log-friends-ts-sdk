import { describe, expect, it } from "vitest";
import {
  estimateByteSize,
  generateEventId,
  isValidEventName,
  sanitizePayload,
} from "../../src/core/event-sanitizer.js";

describe("event-sanitizer", () => {
  it("validates camelCase event names strictly", () => {
    expect(isValidEventName("orderCompleted")).toBe(true);
    expect(isValidEventName("itemAddedToCart")).toBe(true);
    expect(isValidEventName("click")).toBe(true);
    expect(isValidEventName("a1")).toBe(true);

    expect(isValidEventName("OrderCompleted")).toBe(false); // PascalCase
    expect(isValidEventName("order_completed")).toBe(false); // snake_case
    expect(isValidEventName("order-completed")).toBe(false); // kebab-case
    expect(isValidEventName("")).toBe(false);
    expect(isValidEventName("1order")).toBe(false);
  });

  it("generates valid UUID v4 event IDs", () => {
    const id1 = generateEventId();
    const id2 = generateEventId();
    expect(id1).toBeTypeOf("string");
    expect(id1).toHaveLength(36);
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("sanitizes circular references without throwing", () => {
    const obj: Record<string, unknown> = { name: "test", level: 1 };
    obj.self = obj;

    const sanitized = sanitizePayload(obj);
    expect(sanitized).toBeDefined();
    expect(sanitized?.name).toBe("test");
    expect(sanitized?.self).toBe("[Circular]");
  });

  it("truncates objects exceeding max depth", () => {
    let deep: Record<string, unknown> = { val: "leaf" };
    for (let i = 0; i < 15; i++) {
      deep = { next: deep };
    }

    const sanitized = sanitizePayload(deep);
    expect(sanitized).toBeDefined();
    const json = JSON.stringify(sanitized);
    expect(json).toContain("[Truncated: Max Depth Reached]");
  });

  it("converts Date, Error, BigInt, Map, and Set safely", () => {
    const error = new Error("Sample error");
    const date = new Date("2026-08-27T00:00:00.000Z");
    const map = new Map<string, unknown>([["k1", "v1"], ["k2", 42]]);
    const set = new Set(["a", "b", "c"]);

    const payload = {
      timestamp: date,
      err: error,
      largeNum: BigInt(9007199254740991),
      mapData: map,
      setData: set,
    };

    const sanitized = sanitizePayload(payload);
    expect(sanitized?.timestamp).toBe("2026-08-27T00:00:00.000Z");
    expect(sanitized?.err).toEqual({
      name: "Error",
      message: "Sample error",
      stack: expect.any(String),
    });
    expect(sanitized?.largeNum).toBe("9007199254740991");
    expect(sanitized?.mapData).toEqual({ k1: "v1", k2: 42 });
    expect(sanitized?.setData).toEqual(["a", "b", "c"]);
  });

  it("estimates byte size correctly", () => {
    expect(estimateByteSize("hello")).toBe(5);
    expect(estimateByteSize({ a: 1 })).toBe(7); // '{"a":1}'
    expect(estimateByteSize(null)).toBe(0);
  });
});
