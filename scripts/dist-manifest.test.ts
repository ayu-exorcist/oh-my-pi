import { describe, expect, test } from "vitest";

import { buildDistManifest } from "./dist-manifest";

describe("dist manifest wrapper", () => {
  test("re-exports buildDistManifest", () => {
    expect(buildDistManifest).toBeTypeOf("function");
  });
});
