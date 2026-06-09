import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { buildDistManifest } from "../dist-manifest";

function runDistManifest(cwd: string): void {
  buildDistManifest(cwd);
}

describe("dist manifest generation", () => {
  test("copies README and adds readme metadata to dist package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "dist-manifest-test-"));
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify(
          {
            name: "pkg",
            version: "1.0.0",
            main: "src/index.ts",
            types: "src/index.d.ts",
            exports: {
              ".": "./src/index.ts",
              "./nested": {
                import: "./src/nested.ts",
                default: 123,
              },
            },
            pi: {
              extensions: ["./src/index.ts", "./src/extra.ts"],
            },
            dependencies: {
              "workspace-a": "workspace:*",
              external: "^1.0.0",
            },
            scripts: {
              build: "tsdown",
            },
            devDependencies: {
              vitest: "^4.1.7",
            },
            files: ["README.md"],
          },
          null,
          2,
        ),
        "utf8",
      );
      writeFileSync(join(root, "README.md"), "# pkg\n\nhello world\n", "utf8");

      runDistManifest(root);

      const distPackageJson = JSON.parse(readFileSync(join(root, "dist", "package.json"), "utf8"));
      expect(distPackageJson.readme).toBe("# pkg\n\nhello world\n");
      expect(distPackageJson.readmeFilename).toBe("README.md");
      expect(distPackageJson.main).toBe("index.mjs");
      expect(distPackageJson.types).toBe("index.d.mjs");
      expect(distPackageJson.exports).toEqual({
        ".": "./index.mjs",
        "./nested": {
          import: "./nested.mjs",
          default: 123,
        },
      });
      expect(distPackageJson.pi).toEqual({
        extensions: ["./index.mjs", "./extra.mjs"],
      });
      expect(distPackageJson.dependencies).toEqual({ external: "^1.0.0" });
      expect(existsSync(join(root, "dist", "README.md"))).toBe(true);
      expect(readFileSync(join(root, "dist", "README.md"), "utf8")).toBe("# pkg\n\nhello world\n");
      expect(distPackageJson.scripts).toBeUndefined();
      expect(distPackageJson.devDependencies).toBeUndefined();
      expect(distPackageJson.files).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("omits readme metadata when README is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "dist-manifest-test-"));
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "pkg", version: "1.0.0" }, null, 2),
        "utf8",
      );

      runDistManifest(root);

      const distPackageJson = JSON.parse(readFileSync(join(root, "dist", "package.json"), "utf8"));
      expect(distPackageJson.readme).toBeUndefined();
      expect(distPackageJson.readmeFilename).toBeUndefined();
      expect(existsSync(join(root, "dist", "README.md"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a non-object package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "dist-manifest-test-"));
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(join(root, "package.json"), "[]", "utf8");

      expect(() => runDistManifest(root)).toThrow("package.json must be an object");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
