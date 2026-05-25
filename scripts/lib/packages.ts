import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { isPkgJson } from "./guards";
import type { PackageInfo } from "./types";
import { WORKSPACE_DIRS } from "./types";

/** Read the root `package.json` when it is not marked private. */
export function getRootPackage(root: string): PackageInfo | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!isPkgJson(parsed)) return null;
  if (parsed.private) return null;
  return {
    name: parsed.name,
    version: parsed.version,
    path: root,
    pkg: parsed,
    isRoot: true,
  };
}

/** Discover publishable packages inside `extensions/` and `sdk/`. */
export function getWorkspacePackages(root: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  for (const dir of WORKSPACE_DIRS) {
    const fullDir = resolve(root, dir);
    if (!existsSync(fullDir)) continue;
    for (const sub of readdirSync(fullDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const pkgPath = join(fullDir, sub.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (!isPkgJson(parsed)) continue;
      if (parsed.private) continue;
      packages.push({
        name: parsed.name,
        version: parsed.version,
        path: join(fullDir, sub.name),
        pkg: parsed,
        isRoot: false,
      });
    }
  }
  return packages;
}

/** Return every publishable package (workspace + root). */
export function getPackages(root: string): PackageInfo[] {
  const rootPkg = getRootPackage(root);
  const workspacePkgs = getWorkspacePackages(root);
  if (rootPkg) {
    return [...workspacePkgs, rootPkg];
  }
  return workspacePkgs;
}
