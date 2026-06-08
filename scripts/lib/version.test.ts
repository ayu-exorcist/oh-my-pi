import { describe, expect, test } from "vitest";

import { bumpPatchVersion } from "./version";

describe("version helpers", () => {
  test("bumps patch versions and strips prerelease suffixes", () => {
    expect(bumpPatchVersion("1.2.3")).toBe("1.2.4");
    expect(bumpPatchVersion("1.2.3-beta.1")).toBe("1.2.4");
  });

  test("rejects unsupported version formats", () => {
    expect(() => bumpPatchVersion("latest")).toThrow("Unsupported version format: latest");
    expect(() => bumpPatchVersion("1.2")).toThrow("Unsupported version format: 1.2");
  });
});
