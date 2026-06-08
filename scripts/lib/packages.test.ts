import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { getPackages, getRootPackage, getWorkspacePackages } from "./packages";

function writePackageJson(dir: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(value), "utf8");
}

describe("package discovery", () => {
  test("returns null when the root package is missing, invalid, or private", () => {
    const root = mkdtempSync(join(tmpdir(), "packages-test-"));
    try {
      expect(getRootPackage(root)).toBeNull();

      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root" }), "utf8");
      expect(getRootPackage(root)).toBeNull();

      writePackageJson(root, { name: "root", version: "1.0.0", private: true });
      expect(getRootPackage(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns a publishable root package", () => {
    const root = mkdtempSync(join(tmpdir(), "packages-test-"));
    try {
      writePackageJson(root, { name: "root", version: "1.0.0" });

      expect(getRootPackage(root)).toEqual({
        name: "root",
        version: "1.0.0",
        path: root,
        pkg: { name: "root", version: "1.0.0" },
        isRoot: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("discovers publishable workspace packages and skips invalid entries", () => {
    const root = mkdtempSync(join(tmpdir(), "packages-test-"));
    try {
      mkdirSync(join(root, "extensions", "not-a-package"), { recursive: true });
      writeFileSync(join(root, "extensions", "README.md"), "not a directory", "utf8");
      writePackageJson(join(root, "extensions", "valid"), { name: "valid", version: "1.0.0" });
      writePackageJson(join(root, "extensions", "private"), {
        name: "private",
        version: "1.0.0",
        private: true,
      });
      writePackageJson(join(root, "sdk", "invalid"), { name: "invalid" });
      writePackageJson(join(root, "sdk", "sdk-pkg"), { name: "sdk-pkg", version: "2.0.0" });

      expect(getWorkspacePackages(root)).toEqual([
        {
          name: "valid",
          version: "1.0.0",
          path: join(root, "extensions", "valid"),
          pkg: { name: "valid", version: "1.0.0" },
          isRoot: false,
        },
        {
          name: "sdk-pkg",
          version: "2.0.0",
          path: join(root, "sdk", "sdk-pkg"),
          pkg: { name: "sdk-pkg", version: "2.0.0" },
          isRoot: false,
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("combines workspace and root packages", () => {
    const root = mkdtempSync(join(tmpdir(), "packages-test-"));
    try {
      writePackageJson(root, { name: "root", version: "1.0.0" });
      writePackageJson(join(root, "extensions", "valid"), { name: "valid", version: "2.0.0" });

      expect(getPackages(root).map((pkg) => pkg.name)).toEqual(["valid", "root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns workspace packages when root package is private", () => {
    const root = mkdtempSync(join(tmpdir(), "packages-test-"));
    try {
      writePackageJson(root, { name: "root", version: "1.0.0", private: true });
      writePackageJson(join(root, "sdk", "valid"), { name: "valid", version: "2.0.0" });

      expect(getPackages(root).map((pkg) => pkg.name)).toEqual(["valid"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns an empty array when workspace folders are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "packages-test-"));
    try {
      expect(getWorkspacePackages(root)).toEqual([]);
      expect(getPackages(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
