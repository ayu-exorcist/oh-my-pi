import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewritePaths(value: unknown): unknown {
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

function filterWorkspaceDeps(deps: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(deps).filter(([, version]) => !String(version).startsWith("workspace:")),
  );
}

export function buildDistManifest(cwd: string): void {
  const pkgJsonPath = join(cwd, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));

  if (!isRecord(pkgJson)) {
    throw new Error("package.json must be an object");
  }

  const manifest: Record<string, unknown> = { ...pkgJson };

  if (manifest.main) manifest.main = rewritePaths(manifest.main);
  if (manifest.types) manifest.types = rewritePaths(manifest.types);
  if (manifest.exports) manifest.exports = rewritePaths(manifest.exports);

  const pi = manifest.pi;
  if (isRecord(pi) && Array.isArray(pi.extensions)) {
    pi.extensions = rewritePaths(pi.extensions) as unknown[];
  }

  delete manifest.scripts;
  delete manifest.devDependencies;
  delete manifest.files;

  if (isRecord(manifest.dependencies)) {
    manifest.dependencies = filterWorkspaceDeps(manifest.dependencies) as Record<string, string>;
  }

  const distDir = join(cwd, "dist");
  mkdirSync(distDir, { recursive: true });

  const readmePath = join(cwd, "README.md");
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, "utf8");
    manifest.readme = readme;
    manifest.readmeFilename = "README.md";
    copyFileSync(readmePath, join(distDir, "README.md"));
  }

  writeFileSync(join(distDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`✅ dist/package.json for ${String(pkgJson.name)}`);
}

/* c8 ignore next 3 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildDistManifest(process.cwd());
}
