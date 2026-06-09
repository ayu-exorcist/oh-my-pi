import { describe, expect, test } from "vitest";

import {
  errorMessage,
  getArrayField,
  getStringField,
  isArrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
} from "../../sdk/pi-checkpoint/src/guards";

describe("checkpoint guards", () => {
  test("covers primitive and record guards", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isString("x")).toBe(true);
    expect(isString(1)).toBe(false);
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
    expect(getStringField("nope", "name")).toBeUndefined();
    expect(getArrayField({ items: [1, 2] }, "items")).toEqual([1, 2]);
    expect(getArrayField("nope", "items")).toBeUndefined();
  });

  test("covers errorMessage fallback", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("boom")).toBe("boom");
  });
});
