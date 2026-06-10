import { describe, expect, test } from "vitest";
import {
  errorMessage,
  getArrayField,
  getBooleanField,
  getNumberField,
  getRecordField,
  getStringField,
  hasItems,
  isArrayOf,
  isBoolean,
  isNonEmptyString,
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

describe("isNonEmptyString", () => {
  test("returns true only for non-empty strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
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

describe("field accessors", () => {
  test("extract fields from records", () => {
    const nested = { ok: true };
    expect(getStringField({ name: "test" }, "name")).toBe("test");
    expect(getNumberField({ count: 5 }, "count")).toBe(5);
    expect(getBooleanField({ enabled: false }, "enabled")).toBe(false);
    expect(getRecordField({ nested }, "nested")).toBe(nested);
    expect(getArrayField({ items: [1, 2] }, "items")).toEqual([1, 2]);
  });

  test("return undefined for non-records or mismatched fields", () => {
    expect(getStringField("not-record", "name")).toBeUndefined();
    expect(getStringField({ age: 25 }, "age")).toBeUndefined();
    expect(getStringField({}, "missing")).toBeUndefined();
    expect(getNumberField("not-record", "count")).toBeUndefined();
    expect(getNumberField({ count: Number.NaN }, "count")).toBeUndefined();
    expect(getBooleanField("not-record", "enabled")).toBeUndefined();
    expect(getBooleanField({ enabled: "false" }, "enabled")).toBeUndefined();
    expect(getRecordField("not-record", "nested")).toBeUndefined();
    expect(getRecordField({ nested: [] }, "nested")).toBeUndefined();
    expect(getArrayField("not-record", "items")).toBeUndefined();
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

describe("hasItems", () => {
  test("narrows non-empty arrays", () => {
    expect(hasItems(["a"])).toBe(true);
    expect(hasItems([])).toBe(false);
  });
});
