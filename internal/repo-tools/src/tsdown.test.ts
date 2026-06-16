import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createDependencyChunkNamer, createTsdownConfig } from "./tsdown";

describe("tsdown helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns dependency chunks and caches package lookups", () => {
    const root = mkdtempSync(join(tmpdir(), "tsdown-helper-"));
    try {
      mkdirSync(join(root, "pkg-a"), { recursive: true });
      writeFileSync(join(root, "pkg-a", "package.json"), JSON.stringify({ name: "pkg-a" }));
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "pkg-b" }));

      const namer = createDependencyChunkNamer(root);
      expect(namer("\0virtual")).toBeUndefined();
      expect(namer(join(root, "pkg-a", "src", "index.ts"))).toBe("pkg-a");
      expect(namer(join(root, "pkg-a", "src", "other.ts"))).toBe("pkg-a");
      expect(namer(join(root, "pkg-b", "src", "index.ts"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("handles invalid manifests and root walking", () => {
    const root = mkdtempSync(join(tmpdir(), "tsdown-helper-"));
    try {
      mkdirSync(join(root, "pkg-a"), { recursive: true });
      writeFileSync(join(root, "pkg-a", "package.json"), JSON.stringify({ name: "pkg-a" }));
      writeFileSync(join(root, "package.json"), "not json");

      const namer = createDependencyChunkNamer(root);
      expect(namer(join(root, "pkg-a", "src", "index.ts"))).toBe("pkg-a");
      expect(namer(join(tmpdir(), "outside", "file.ts"))).toBeUndefined();

      const baseConfig = createTsdownConfig({ entry: ["src/main.ts"], dts: true });
      expect(baseConfig).toMatchObject({ entry: ["src/main.ts"], dts: true, format: "esm" });
      expect(
        (baseConfig as { outExtensions: () => Record<string, string> }).outExtensions(),
      ).toEqual({
        js: ".js",
      });

      const chunkedConfig = createTsdownConfig({
        dependencyChunks: true,
        alwaysBundle: ["dep-a"],
      });
      const outputOptions = (
        chunkedConfig as {
          outputOptions: (value: Record<string, unknown>) => Record<string, unknown>;
        }
      ).outputOptions({
        codeSplitting: {},
      });
      const groupName = (
        outputOptions.codeSplitting as {
          groups: Array<{ name: (moduleId: string) => string | null }>;
        }
      ).groups[0]?.name;
      expect(groupName).toBeTypeOf("function");
      expect(groupName?.(join(root, "package.json"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("readPackageName rejects non-object JSON values like arrays and strings", () => {
    const root = mkdtempSync(join(tmpdir(), "tsdown-nonobj-"));
    try {
      // An array parsed from JSON should not be treated as a record
      mkdirSync(join(root, "arr-pkg"), { recursive: true });
      writeFileSync(join(root, "arr-pkg", "package.json"), JSON.stringify(["not", "an", "object"]));
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root-pkg" }));

      const namer = createDependencyChunkNamer(root);
      // The arr-pkg dir should yield null from readPackageName (isRecord fails)
      expect(namer(join(root, "arr-pkg", "src", "index.ts"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cached lookup returns undefined when packageName matches currentPackageName", () => {
    const root = mkdtempSync(join(tmpdir(), "tsdown-cache-same-"));
    try {
      mkdirSync(join(root, "same-pkg"), { recursive: true });
      writeFileSync(join(root, "same-pkg", "package.json"), JSON.stringify({ name: "same-pkg" }));
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "same-pkg" }));

      const namer = createDependencyChunkNamer(root);
      // First call: reads and caches "same-pkg" for same-pkg/package.json
      expect(namer(join(root, "same-pkg", "src", "index.ts"))).toBeUndefined();
      // Second call: hits the cached branch with cached === currentPackageName
      expect(namer(join(root, "same-pkg", "src", "other.ts"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
