import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { stageRootPublishManifest } from "./root-publish-manifest-stage";

function writeRootPackageJson(root: string, value: unknown): string {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(root, "package.json"), content, "utf8");
  return content;
}

describe("root publish manifest staging", () => {
  test("removes workspace dev dependencies while preserving external dev dependencies", () => {
    const root = mkdtempSync(join(tmpdir(), "root-publish-manifest-stage-test-"));
    try {
      const original = writeRootPackageJson(root, {
        name: "root",
        version: "1.0.0",
        dependencies: { child: "workspace:*" },
        devDependencies: {
          "@ayulab/runtime-core": "workspace:*",
          "@ayulab/repo-tools": "workspace:*",
          vitest: "^4.1.8",
        },
      });

      const result = stageRootPublishManifest(root);

      expect(result.ok).toBe(true);
      const staged = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      expect(staged.dependencies).toEqual({ child: "workspace:*" });
      expect(staged.devDependencies).toEqual({ vitest: "^4.1.8" });

      if (result.ok) result.restore();
      expect(readFileSync(join(root, "package.json"), "utf8")).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("omits devDependencies when every dev dependency is a workspace dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "root-publish-manifest-stage-test-"));
    try {
      writeRootPackageJson(root, {
        name: "root",
        version: "1.0.0",
        devDependencies: { "@ayulab/repo-tools": "workspace:*" },
      });

      const result = stageRootPublishManifest(root);

      expect(result.ok).toBe(true);
      const staged = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      expect(staged.devDependencies).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves package metadata unchanged when there are no dev dependencies", () => {
    const root = mkdtempSync(join(tmpdir(), "root-publish-manifest-stage-test-"));
    try {
      const original = writeRootPackageJson(root, { name: "root", version: "1.0.0" });

      const result = stageRootPublishManifest(root);

      expect(result.ok).toBe(true);
      expect(readFileSync(join(root, "package.json"), "utf8")).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves package metadata unchanged when dev dependencies are publishable", () => {
    const root = mkdtempSync(join(tmpdir(), "root-publish-manifest-stage-test-"));
    try {
      const original = writeRootPackageJson(root, {
        name: "root",
        version: "1.0.0",
        devDependencies: { vitest: "^4.1.8" },
      });

      const result = stageRootPublishManifest(root);

      expect(result.ok).toBe(true);
      expect(readFileSync(join(root, "package.json"), "utf8")).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects non-object package metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "root-publish-manifest-stage-test-"));
    try {
      writeFileSync(join(root, "package.json"), "[]", "utf8");
      expect(stageRootPublishManifest(root)).toEqual({
        ok: false,
        message: `❌ ${join(root, "package.json")} must contain a JSON object.`,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
