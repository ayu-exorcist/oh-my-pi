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
} from "./guards";

describe("isRecord", () => {
  test("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  test("returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("isString", () => {
  test("returns true for strings", () => {
    expect(isString("hello")).toBe(true);
    expect(isString("")).toBe(true);
  });

  test("returns false for non-strings", () => {
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
  });
});

describe("isNumber", () => {
  test("returns true for numbers excluding NaN", () => {
    expect(isNumber(42)).toBe(true);
    expect(isNumber(0)).toBe(true);
    expect(isNumber(-1)).toBe(true);
  });

  test("returns false for NaN and non-numbers", () => {
    expect(isNumber(NaN)).toBe(false);
    expect(isNumber("42")).toBe(false);
    expect(isNumber(null)).toBe(false);
  });
});

describe("isBoolean", () => {
  test("returns true for booleans", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });

  test("returns false for non-booleans", () => {
    expect(isBoolean(1)).toBe(false);
    expect(isBoolean("true")).toBe(false);
    expect(isBoolean(null)).toBe(false);
  });
});

describe("isStringArray", () => {
  test("returns true for string arrays", () => {
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray([])).toBe(true);
  });

  test("returns false for non-string arrays", () => {
    expect(isStringArray([1, 2])).toBe(false);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray("not-array")).toBe(false);
  });
});

describe("isArrayOf", () => {
  test("creates guard for specific element type", () => {
    const isNumberArray = isArrayOf(isNumber);
    expect(isNumberArray([1, 2, 3])).toBe(true);
    expect(isNumberArray([1, "two", 3])).toBe(false);
    expect(isNumberArray("not-array")).toBe(false);
  });

  test("creates guard for string arrays", () => {
    const isStrArray = isArrayOf(isString);
    expect(isStrArray(["a", "b"])).toBe(true);
    expect(isStrArray([])).toBe(true);
    expect(isStrArray([1, 2])).toBe(false);
  });
});

describe("getStringField", () => {
  test("extracts string field from record", () => {
    expect(getStringField({ name: "test" }, "name")).toBe("test");
  });

  test("returns undefined for non-record", () => {
    expect(getStringField("not-record", "name")).toBeUndefined();
  });

  test("returns undefined for non-string field", () => {
    expect(getStringField({ age: 25 }, "age")).toBeUndefined();
    expect(getStringField({}, "missing")).toBeUndefined();
  });
});

describe("getArrayField", () => {
  test("extracts array field from record", () => {
    expect(getArrayField({ items: [1, 2] }, "items")).toEqual([1, 2]);
  });

  test("returns undefined for non-record", () => {
    expect(getArrayField("not-record", "items")).toBeUndefined();
  });

  test("returns undefined for non-array field", () => {
    expect(getArrayField({ count: 5 }, "count")).toBeUndefined();
    expect(getArrayField({}, "missing")).toBeUndefined();
  });
});

describe("errorMessage", () => {
  test("extracts message from Error", () => {
    expect(errorMessage(new Error("test error"))).toBe("test error");
  });

  test("converts non-errors to string", () => {
    expect(errorMessage("string error")).toBe("string error");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
