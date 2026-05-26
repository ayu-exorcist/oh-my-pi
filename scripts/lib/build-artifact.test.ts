import { describe, expect, test } from "vitest";
import { materializeBuildArtifactManifest } from "./build-artifact";

describe("Build Artifact manifest", () => {
  test("rewrites source paths for dist package", () => {
    const manifest = materializeBuildArtifactManifest({
      pkgJson: {
        name: "@ayulab/pi-rewind",
        version: "1.0.0",
        main: "src/index.ts",
        types: "./src/index.d.ts",
        exports: {
          ".": "./src/index.ts",
          "./commands/rewind": "./src/commands/rewind.ts",
        },
        pi: { extensions: ["./src/index.ts"] },
      },
      workspacePackageNames: new Set(),
    });

    expect(manifest).toMatchObject({
      main: "index.mjs",
      types: "./index.d.mjs",
      exports: {
        ".": "./index.mjs",
        "./commands/rewind": "./commands/rewind.mjs",
      },
      pi: { extensions: ["./index.mjs"] },
    });
  });

  test("strips build-only fields and removes workspace dependencies", () => {
    const manifest = materializeBuildArtifactManifest({
      pkgJson: {
        name: "@ayulab/pi-rewind",
        version: "1.0.0",
        scripts: { build: "tsdown" },
        devDependencies: { vitest: "latest" },
        files: ["src", "README.md"],
        dependencies: {
          "@ayulab/pi-checkpoint": "workspace:*",
          chalk: "^5.0.0",
        },
      },
      workspacePackageNames: new Set(["@ayulab/pi-checkpoint"]),
    });

    expect(manifest).toEqual({
      name: "@ayulab/pi-rewind",
      version: "1.0.0",
      dependencies: { chalk: "^5.0.0" },
    });
  });

  test("leaves non-path nested export values unchanged", () => {
    const manifest = materializeBuildArtifactManifest({
      pkgJson: {
        name: "pkg",
        version: "1.0.0",
        exports: { ".": { import: "./src/index.ts", custom: false } },
      },
      workspacePackageNames: new Set(),
    });

    expect(manifest).toEqual({
      name: "pkg",
      version: "1.0.0",
      exports: { ".": { import: "./index.mjs", custom: false } },
    });
  });

  test("handles manifests without optional fields", () => {
    const manifest = materializeBuildArtifactManifest({
      pkgJson: { name: "pkg", version: "1.0.0" },
      workspacePackageNames: new Set(),
    });

    expect(manifest).toEqual({ name: "pkg", version: "1.0.0" });
  });
});
