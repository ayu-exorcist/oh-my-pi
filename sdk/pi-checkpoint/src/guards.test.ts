import { describe, test, expect } from "vitest";
import { isArrayOf, isNumber, isRecord, isString } from "./guards";

describe("isArrayOf", () => {
  test("accepts arrays where every element passes the guard", () => {
    const isNumberArray = isArrayOf(isNumber);
    expect(isNumberArray([1, 2, 3])).toBe(true);
  });

  test("rejects non-arrays", () => {
    const isNumberArray = isArrayOf(isNumber);
    expect(isNumberArray("not-array")).toBe(false);
    expect(isNumberArray(123)).toBe(false);
    expect(isNumberArray({})).toBe(false);
  });

  test("rejects arrays with failing elements", () => {
    const isNumberArray = isArrayOf(isNumber);
    expect(isNumberArray([1, "two", 3])).toBe(false);
    expect(isNumberArray([1, null, 3])).toBe(false);
  });

  test("accepts empty arrays", () => {
    const isStringArray = isArrayOf(isString);
    expect(isStringArray([])).toBe(true);
  });
});

describe("isRecord", () => {
  test("rejects arrays", () => {
    expect(isRecord([])).toBe(false);
  });
});
