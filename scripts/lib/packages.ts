import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { isPkgJson } from "./package-json";
import type { PackageInfo } from "./types";
import { PUBLISHABLE_WORKSPACE_DIRS, RELEASE_INPUT_WORKSPACE_DIRS } from "./types";

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

function getWorkspacePackagesInDirs(
  root: string,
  dirs: readonly string[],
  options: { readonly includePrivate: boolean },
): PackageInfo[] {
  const packages: PackageInfo[] = [];
  for (const dir of dirs) {
    const fullDir = resolve(root, dir);
    if (!existsSync(fullDir)) continue;
    for (const sub of readdirSync(fullDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const pkgPath = join(fullDir, sub.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (!isPkgJson(parsed)) continue;
      if (parsed.private && !options.includePrivate) continue;
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

/** Discover publishable packages inside `extensions/` and `sdk/`. */
export function getWorkspacePackages(root: string): PackageInfo[] {
  return getWorkspacePackagesInDirs(root, PUBLISHABLE_WORKSPACE_DIRS, { includePrivate: false });
}

/** Discover every workspace package that can affect release inputs. */
export function getReleaseInputWorkspacePackages(root: string): PackageInfo[] {
  return getWorkspacePackagesInDirs(root, RELEASE_INPUT_WORKSPACE_DIRS, { includePrivate: true });
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
