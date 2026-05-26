import { cpSync, existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { PackageInfo } from "./types";

export interface StageBundledBuildArtifactsOptions {
  readonly root: string;
  readonly rootPkg: PackageInfo;
  readonly nameMap: ReadonlyMap<string, PackageInfo>;
}

export type StageBundledBuildArtifactsResult =
  | { readonly ok: true; readonly restores: readonly (() => void)[] }
  | { readonly ok: false; readonly message: string };

function bundledDependencies(pkg: PackageInfo): readonly string[] {
  return Array.isArray(pkg.pkg.bundledDependencies)
    ? pkg.pkg.bundledDependencies.filter((dep) => typeof dep === "string")
    : [];
}

export function stageBundledBuildArtifacts(
  options: StageBundledBuildArtifactsOptions,
): StageBundledBuildArtifactsResult {
  const restores: (() => void)[] = [];

  for (const depName of bundledDependencies(options.rootPkg)) {
    const depPkg = options.nameMap.get(depName);
    if (!depPkg) continue;

    const distPath = join(depPkg.path, "dist");
    if (!existsSync(distPath)) {
      return { ok: false, message: `❌ ${depName} dist/ not found. Run build first.` };
    }

    const nmPath = join(options.root, "node_modules", depName);
    if (!existsSync(nmPath)) {
      return { ok: false, message: `❌ ${nmPath} not found. Run pnpm install first.` };
    }

    const stat = lstatSync(nmPath);
    const isSymlink = stat.isSymbolicLink();
    const originalTarget = isSymlink ? readlinkSync(nmPath) : null;

    rmSync(nmPath, { recursive: true });
    cpSync(distPath, nmPath, { recursive: true });

    restores.push(() => {
      rmSync(nmPath, { recursive: true });
      if (originalTarget !== null) {
        symlinkSync(originalTarget, nmPath);
      }
    });
  }

  return { ok: true, restores };
}
