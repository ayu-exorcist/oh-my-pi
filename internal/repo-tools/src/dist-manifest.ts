#!/usr/bin/env oxnode
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  realpathSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewritePaths(value: string): string;
function rewritePaths(value: readonly unknown[]): unknown[];
function rewritePaths(value: Record<string, unknown>): Record<string, unknown>;
function rewritePaths(value: unknown): unknown;
function rewritePaths(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.replace(/^\.\/src\//, "./").replace(/^src\//, "");
    if (normalized.endsWith(".d.ts")) return normalized;
    return normalized.replace(/\.ts$/, ".js");
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

function filterWorkspaceDeps(deps: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(deps).filter(([, version]) => !String(version).startsWith("workspace:")),
  );
}

function listDistFiles(distDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const fullPath = join(dir, name);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const file = relative(distDir, fullPath).replace(/\\/g, "/");
      if (file !== "package.json") files.push(file);
    }
  }

  walk(distDir);
  return files;
}

export function buildDistManifest(cwd: string): void {
  const pkgJsonPath = join(cwd, "package.json");
  const pkgJson: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf8"));

  if (!isRecord(pkgJson)) {
    throw new Error("package.json must be an object");
  }

  const manifest: Record<string, unknown> = { ...pkgJson };

  if (manifest.main) manifest.main = rewritePaths(manifest.main);
  if (manifest.types) manifest.types = rewritePaths(manifest.types);
  if (manifest.exports) manifest.exports = rewritePaths(manifest.exports);

  const pi = manifest.pi;
  if (isRecord(pi) && Array.isArray(pi.extensions)) {
    pi.extensions = rewritePaths(pi.extensions);
  }

  delete manifest.scripts;
  delete manifest.devDependencies;
  delete manifest.engines;
  delete manifest.files;

  if (isRecord(manifest.dependencies)) {
    manifest.dependencies = filterWorkspaceDeps(manifest.dependencies);
  }

  const distDir = join(cwd, "dist");
  mkdirSync(distDir, { recursive: true });

  const readmePath = join(cwd, "README.md");
  if (existsSync(readmePath)) {
    copyFileSync(readmePath, join(distDir, "README.md"));
  }

  manifest.files = listDistFiles(distDir);

  writeFileSync(join(distDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`✅ dist/package.json for ${String(pkgJson.name)}`);
}

function isCliEntry(): boolean {
  /* c8 ignore next */
  if (!process.argv[1]) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
}

/* c8 ignore next 3 */
if (isCliEntry()) {
  buildDistManifest(process.cwd());
}
