import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getPackages } from "./lib/packages";
import { buildDepGraph, topoSort } from "./lib/deps";
import type { PackageInfo } from "./lib/types";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Rewrite TS source paths to distribution paths for dist/package.json. */
function rewritePaths(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/^\.\/src\//, "./")
      .replace(/^src\//, "")
      .replace(/\.ts$/, ".mjs");
  }
  if (Array.isArray(value)) {
    return value.map(rewritePaths);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewritePaths(v)]));
  }
  return value;
}

/** Build a single workspace package into dist/. */
function buildPackage(pkg: PackageInfo, nameMap: Map<string, PackageInfo>): void {
  console.log(`🔨 Building ${pkg.name}...`);

  execSync("pnpm build", {
    cwd: pkg.path,
    stdio: "inherit",
  });

  const pkgJson = JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;

  pkgJson.main = rewritePaths(pkgJson.main);
  if (pkgJson.types) pkgJson.types = rewritePaths(pkgJson.types);
  if (pkgJson.exports) pkgJson.exports = rewritePaths(pkgJson.exports);
  if ((pkgJson.pi as Record<string, unknown> | undefined)?.extensions) {
    (pkgJson.pi as Record<string, unknown>).extensions = rewritePaths(
      (pkgJson.pi as Record<string, unknown>).extensions,
    );
  }

  delete pkgJson.scripts;
  delete pkgJson.devDependencies;
  delete pkgJson.files;

  const deps = pkgJson.dependencies as Record<string, unknown> | undefined;
  if (deps) {
    for (const dep of Object.keys(deps)) {
      if (nameMap.has(dep)) {
        delete deps[dep];
      }
    }
  }

  writeFileSync(join(pkg.path, "dist", "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

  const readmePath = join(pkg.path, "README.md");
  if (existsSync(readmePath)) {
    copyFileSync(readmePath, join(pkg.path, "dist", "README.md"));
  }
}

function main(): void {
  const packages = getPackages(root);
  const { graph, inDegree, nameMap } = buildDepGraph(packages);

  const sorted = topoSort(
    [...nameMap.keys()].filter((n) => !nameMap.get(n)?.isRoot),
    graph,
    inDegree,
  );

  for (const name of sorted) {
    const pkg = nameMap.get(name);
    if (!pkg || pkg.isRoot) continue;
    buildPackage(pkg, nameMap);
  }

  console.log("✅ Build complete");
}

main();
