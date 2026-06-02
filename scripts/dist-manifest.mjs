#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewritePaths(value) {
  if (typeof value === "string") {
    return value
      .replace(/^\.\/src\//, "./")
      .replace(/^src\//, "")
      .replace(/\.d\.ts$/, ".d.mjs")
      .replace(/\.ts$/, ".mjs");
  }
  if (Array.isArray(value)) {
    return value.map(rewritePaths);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, rewritePaths(nested)]),
    );
  }
  return value;
}

function filterWorkspaceDeps(deps) {
  if (!isRecord(deps)) return deps;
  return Object.fromEntries(
    Object.entries(deps).filter(([, version]) => !String(version).startsWith("workspace:")),
  );
}

const pkgJsonPath = join(cwd, "package.json");
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));

if (!isRecord(pkgJson)) {
  throw new Error("package.json must be an object");
}

const manifest = { ...pkgJson };

if (manifest.main) manifest.main = rewritePaths(manifest.main);
if (manifest.types) manifest.types = rewritePaths(manifest.types);
if (manifest.exports) manifest.exports = rewritePaths(manifest.exports);

const pi = manifest.pi;
if (isRecord(pi) && pi.extensions) {
  pi.extensions = rewritePaths(pi.extensions);
}

delete manifest.scripts;
delete manifest.devDependencies;
delete manifest.files;

if (isRecord(manifest.dependencies)) {
  manifest.dependencies = filterWorkspaceDeps(manifest.dependencies);
}

const distDir = join(cwd, "dist");
writeFileSync(join(distDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");

const readmePath = join(cwd, "README.md");
if (existsSync(readmePath)) {
  copyFileSync(readmePath, join(distDir, "README.md"));
}

console.log(`✅ dist/package.json for ${pkgJson.name}`);
