import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { buildDistManifest } from "./dist-manifest";

function runDistManifest(cwd: string): void {
  buildDistManifest(cwd);
}

describe("dist manifest generation", () => {
  test("copies README and adds generated dist files to dist package.json", () => {
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
            engines: {
              node: ">=24.0.0",
            },
            files: ["README.md"],
          },
          null,
          2,
        ),
        "utf8",
      );
      writeFileSync(join(root, "README.md"), "# pkg\n\nhello world\n", "utf8");
      writeFileSync(join(root, "dist", "package.json"), "{}\n", "utf8");
      writeFileSync(join(root, "dist", "index.js"), "export {};\n", "utf8");
      writeFileSync(join(root, "dist", "index.d.ts"), "export {};\n", "utf8");
      mkdirSync(join(root, "dist", "nested"), { recursive: true });
      writeFileSync(join(root, "dist", "nested", "chunk.js"), "export {};\n", "utf8");

      runDistManifest(root);

      const distPackageJson = JSON.parse(readFileSync(join(root, "dist", "package.json"), "utf8"));
      expect(distPackageJson.readme).toBeUndefined();
      expect(distPackageJson.readmeFilename).toBeUndefined();
      expect(distPackageJson.main).toBe("index.js");
      expect(distPackageJson.types).toBe("index.d.ts");
      expect(distPackageJson.exports).toEqual({
        ".": "./index.js",
        "./nested": {
          import: "./nested.js",
          default: 123,
        },
      });
      expect(distPackageJson.pi).toEqual({
        extensions: ["./index.js", "./extra.js"],
      });
      expect(distPackageJson.dependencies).toEqual({ external: "^1.0.0" });
      expect(existsSync(join(root, "dist", "README.md"))).toBe(true);
      expect(readFileSync(join(root, "dist", "README.md"), "utf8")).toBe("# pkg\n\nhello world\n");
      expect(distPackageJson.scripts).toBeUndefined();
      expect(distPackageJson.devDependencies).toBeUndefined();
      expect(distPackageJson.engines).toBeUndefined();
      expect(distPackageJson.files).toEqual([
        "README.md",
        "index.d.ts",
        "index.js",
        "nested/chunk.js",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("omits README and lists existing dist files when README is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "dist-manifest-test-"));
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(join(root, "dist", "index.js"), "export {};\n", "utf8");
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "pkg", version: "1.0.0" }, null, 2),
        "utf8",
      );

      runDistManifest(root);

      const distPackageJson = JSON.parse(readFileSync(join(root, "dist", "package.json"), "utf8"));
      expect(distPackageJson.readme).toBeUndefined();
      expect(distPackageJson.readmeFilename).toBeUndefined();
      expect(distPackageJson.files).toEqual(["index.js"]);
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
