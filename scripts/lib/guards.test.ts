import { describe, expect, test } from "vitest";
import { isPkgJson, isRecord, isStringArray } from "./guards";

describe("script guards", () => {
  test("narrows string arrays", () => {
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray("a")).toBe(false);
  });

  test("narrows plain records", () => {
    expect(isRecord({ name: "pkg" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(["pkg"])).toBe(false);
  });

  test("narrows package json shape", () => {
    expect(isPkgJson({ name: "pkg", version: "1.0.0" })).toBe(true);
    expect(isPkgJson({ name: "pkg" })).toBe(false);
    expect(isPkgJson(null)).toBe(false);
    expect(isPkgJson({ name: "pkg", version: 1 })).toBe(false);
  });
});
