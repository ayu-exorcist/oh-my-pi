import { describe, expect, test } from "vitest";

import {
  errorMessage,
  getArrayField,
  getBooleanField,
  getNumberField,
  getRecordField,
  getStringField,
  isArrayOf,
  isBoolean,
  isNonEmptyString,
  isNumber,
  isRecord,
  isString,
  isStringArray,
} from "@ayulab/runtime-core";

describe("shared guards", () => {
  test("covers primitive and record guards", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isString("x")).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNumber(1)).toBe(true);
    expect(isNumber(NaN)).toBe(false);
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
  });

  test("covers array guards and field accessors", () => {
    const isNumberArray = isArrayOf(isNumber);
    expect(isNumberArray([1, 2, 3])).toBe(true);
    expect(isNumberArray([1, "2", 3])).toBe(false);
    expect(getStringField({ name: "test" }, "name")).toBe("test");
    expect(getNumberField({ count: 1 }, "count")).toBe(1);
    expect(getBooleanField({ enabled: false }, "enabled")).toBe(false);
    expect(getRecordField({ nested: { ok: true } }, "nested")).toEqual({ ok: true });
    expect(getStringField("nope", "name")).toBeUndefined();
    expect(getArrayField({ items: [1, 2] }, "items")).toEqual([1, 2]);
    expect(getArrayField("nope", "items")).toBeUndefined();
  });

  test("covers errorMessage fallback", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("boom")).toBe("boom");
  });
});
