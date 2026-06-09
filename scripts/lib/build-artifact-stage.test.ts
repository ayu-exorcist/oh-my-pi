import { describe, expect, test } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageBundledBuildArtifacts } from "./build-artifact-stage";
import type { PackageInfo } from "./types";

function pkg(name: string, path: string, bundledDependencies: unknown = []): PackageInfo {
  return {
    name,
    version: "1.0.0",
    path,
    pkg: { name, version: "1.0.0", bundledDependencies },
    isRoot: name === "root",
  };
}

describe("Build Artifact staging", () => {
  test("swaps bundled workspace dependency with its Build Artifact and restores it", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const depPath = join(root, "extensions", "dep");
      const depDist = join(depPath, "dist");
      const nodeModulesDep = join(root, "node_modules", "dep");
      mkdirSync(depDist, { recursive: true });
      mkdirSync(join(root, "node_modules"), { recursive: true });
      writeFileSync(join(depDist, "index.js"), "dist", "utf8");
      symlinkSync(depPath, nodeModulesDep, "junction");

      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, ["dep"]),
        nameMap: new Map([["dep", pkg("dep", depPath)]]),
      });

      expect(result.ok).toBe(true);
      expect(readFileSync(join(nodeModulesDep, "index.js"), "utf8")).toBe("dist");
      if (result.ok) {
        for (const restore of result.restores) restore();
      }
      writeFileSync(join(nodeModulesDep, "source.ts"), "source", "utf8");
      expect(readFileSync(join(depPath, "source.ts"), "utf8")).toBe("source");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports missing node_modules package", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const depPath = join(root, "extensions", "dep");
      mkdirSync(join(depPath, "dist"), { recursive: true });

      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, ["dep"]),
        nameMap: new Map([["dep", pkg("dep", depPath)]]),
      });

      expect(result).toEqual({
        ok: false,
        message: `❌ ${join(root, "node_modules", "dep")} not found. Run pnpm install first.`,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports missing Build Artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, ["dep"]),
        nameMap: new Map([["dep", pkg("dep", join(root, "extensions", "dep"))]]),
      });

      expect(result).toEqual({ ok: false, message: "❌ dep dist/ not found. Run build first." });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ignores non-array bundled dependencies", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, "dep"),
        nameMap: new Map([["dep", pkg("dep", join(root, "extensions", "dep"))]]),
      });

      expect(result).toEqual({ ok: true, restores: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ignores bundled dependencies outside the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, ["external"]),
        nameMap: new Map(),
      });

      expect(result).toEqual({ ok: true, restores: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("restores a copied node_modules package back to a symlink when one existed", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const depPath = join(root, "extensions", "dep");
      const depDist = join(depPath, "dist");
      const nodeModulesDep = join(root, "node_modules", "dep");
      const symlinkTarget = join(root, "vendor", "dep-source");
      mkdirSync(depDist, { recursive: true });
      mkdirSync(join(root, "node_modules"), { recursive: true });
      mkdirSync(symlinkTarget, { recursive: true });
      writeFileSync(join(depDist, "index.js"), "dist", "utf8");
      symlinkSync(symlinkTarget, nodeModulesDep, "junction");

      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, ["dep"]),
        nameMap: new Map([["dep", pkg("dep", depPath)]]),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const restore of result.restores) restore();
      }
      expect(readlinkSync(nodeModulesDep)).toBe(symlinkTarget);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("restores a non-symlink node_modules package by removing staged artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "build-artifact-stage-test-"));
    try {
      const depPath = join(root, "extensions", "dep");
      const depDist = join(depPath, "dist");
      const nodeModulesDep = join(root, "node_modules", "dep");
      mkdirSync(depDist, { recursive: true });
      mkdirSync(nodeModulesDep, { recursive: true });
      writeFileSync(join(depDist, "index.js"), "dist", "utf8");
      writeFileSync(join(nodeModulesDep, "source.ts"), "source", "utf8");

      const result = stageBundledBuildArtifacts({
        root,
        rootPkg: pkg("root", root, ["dep"]),
        nameMap: new Map([["dep", pkg("dep", depPath)]]),
      });

      expect(result.ok).toBe(true);
      expect(readFileSync(join(nodeModulesDep, "index.js"), "utf8")).toBe("dist");
      if (result.ok) {
        for (const restore of result.restores) restore();
      }
      expect(() => readFileSync(join(nodeModulesDep, "index.js"), "utf8")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
