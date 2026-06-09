import { describe, expect, test } from "vitest";

import { getPackageKind, validatePackage, validateRootConsistency } from "./validate";
import type { PackageInfo, PkgJson } from "./types";

function pkg(name: string, path: string, manifest: Partial<PkgJson>, isRoot = false): PackageInfo {
  return {
    name,
    version: manifest.version ?? "1.0.0",
    path,
    pkg: { name, version: manifest.version ?? "1.0.0", ...manifest },
    isRoot,
  };
}

function validManifest(overrides: Partial<PkgJson> = {}): Partial<PkgJson> {
  return {
    files: ["README.md"],
    repository: { url: "https://example.com/repo.git", directory: "extensions/pkg" },
    homepage: "https://example.com/pkg",
    bugs: { url: "https://example.com/issues" },
    publishConfig: { access: "public" },
    keywords: ["pi-package"],
    pi: { extensions: ["dist/index.mjs"] },
    ...overrides,
  };
}

describe("package validation", () => {
  test("classifies root, extension, sdk, and fallback package kinds", () => {
    expect(getPackageKind(pkg("root", "/repo", {}, true))).toBe("root");
    expect(getPackageKind(pkg("ext", "C:\\repo\\extensions\\ext", {}))).toBe("extension");
    expect(getPackageKind(pkg("sdk", "/repo/sdk/sdk", {}))).toBe("sdk");
    expect(getPackageKind(pkg("other", "/repo/packages/other", {}))).toBe("root");
  });

  test("accepts a valid extension manifest", () => {
    expect(validatePackage(pkg("ext", "/repo/extensions/ext", validManifest()))).toEqual([]);
  });

  test("reports required manifest fields", () => {
    const errors = validatePackage(pkg("ext", "/repo/extensions/ext", {}));
    expect(errors.map((error) => error.field)).toEqual([
      "files",
      "repository",
      "homepage",
      "bugs",
      "publishConfig.access",
      "keywords",
      "pi.extensions",
    ]);
  });

  test("requires repository directory for workspace packages", () => {
    const errors = validatePackage(
      pkg(
        "ext",
        "/repo/extensions/ext",
        validManifest({ repository: { url: "https://example.com/repo.git" } }),
      ),
    );
    expect(errors).toEqual([
      {
        pkg: "ext",
        field: "repository.directory",
        message: "is required for workspace packages",
      },
    ]);
  });

  test("requires repository url when repository object is present", () => {
    const errors = validatePackage(
      pkg("root", "/repo", validManifest({ repository: { directory: "." } }), true),
    );
    expect(errors).toEqual([{ pkg: "root", field: "repository.url", message: "is required" }]);
  });

  test("rejects extension-only metadata on sdk packages", () => {
    const errors = validatePackage(pkg("sdk", "/repo/sdk/sdk", validManifest()));
    expect(errors).toEqual([
      {
        pkg: "sdk",
        field: "keywords",
        message: 'must NOT include "pi-package" (SDK packages are not Pi extensions)',
      },
      {
        pkg: "sdk",
        field: "pi.extensions",
        message: "must NOT be set (SDK packages are not extensions)",
      },
    ]);
  });

  test("validates root bundledDependencies consistency", () => {
    const root = pkg(
      "root",
      "/repo",
      {
        dependencies: { "workspace-a": "workspace:*", external: "^1.0.0" },
        bundledDependencies: ["workspace-b", "external"],
      },
      true,
    );
    const workspace = [
      pkg("workspace-a", "/repo/extensions/workspace-a", {}),
      pkg("workspace-b", "/repo/extensions/workspace-b", {}),
    ];

    expect(validateRootConsistency(root, workspace)).toEqual([
      {
        pkg: "root",
        field: "bundledDependencies",
        message: '"workspace-b" is bundled but not in dependencies',
      },
      {
        pkg: "root",
        field: "dependencies",
        message: '"workspace-a" is a workspace dependency but not in bundledDependencies',
      },
    ]);
  });

  test("validates root consistency with missing optional dependency fields", () => {
    const root = pkg("root", "/repo", {}, true);
    const workspace = [pkg("workspace-a", "/repo/extensions/workspace-a", {})];

    expect(validateRootConsistency(root, workspace)).toEqual([]);
  });
});
