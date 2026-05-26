import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getPackages } from "./lib/packages";
import { buildDepGraph, topoSort } from "./lib/deps";
import { materializeBuildArtifactManifest } from "./lib/build-artifact";
import { isRecord } from "./lib/guards";
import type { PackageInfo } from "./lib/types";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Build a single workspace package into dist/. */
function buildPackage(pkg: PackageInfo, nameMap: Map<string, PackageInfo>): void {
  console.log(`🔨 Building ${pkg.name}...`);

  execSync("pnpm build", {
    cwd: pkg.path,
    stdio: "inherit",
  });

  const pkgJson: unknown = JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8"));
  if (!isRecord(pkgJson)) {
    throw new Error(`${pkg.name} package.json must be an object`);
  }

  const artifactManifest = materializeBuildArtifactManifest({
    pkgJson,
    workspacePackageNames: new Set(nameMap.keys()),
  });

  writeFileSync(
    join(pkg.path, "dist", "package.json"),
    JSON.stringify(artifactManifest, null, 2) + "\n",
  );

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
