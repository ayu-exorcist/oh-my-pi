import { describe, expect, test } from "vitest";
import { isPkgJson } from "./package-json";

describe("script package.json guard", () => {
  test("narrows package json shape", () => {
    expect(isPkgJson({ name: "pkg", version: "1.0.0" })).toBe(true);
    expect(isPkgJson({ name: "pkg" })).toBe(false);
    expect(isPkgJson(null)).toBe(false);
    expect(isPkgJson({ name: "pkg", version: 1 })).toBe(false);
  });
});
