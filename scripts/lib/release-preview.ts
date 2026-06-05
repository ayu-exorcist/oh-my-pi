import type { AutoBumpPlanItem } from "./auto-bump";
import type { PackageInfo } from "./types";

function clonePackage(pkg: PackageInfo): PackageInfo {
  return {
    ...pkg,
    pkg: { ...pkg.pkg },
  };
}

export interface ReleasePreviewRow {
  readonly name: string;
  readonly currentVersion: string;
  readonly nextVersion: string;
  readonly bump: boolean;
  readonly publish: boolean;
  readonly status: "will bump" | "will publish" | "skip";
}

/**
 * Return a cloned package list with planned auto-bump versions applied.
 *
 * This is used by dry-run output so publish planning can reflect the versions
 * that would exist after the bump/commit step, without mutating the worktree.
 */
export function applyAutoBumpPlanToPackages(
  packages: readonly PackageInfo[],
  plan: readonly AutoBumpPlanItem[],
): PackageInfo[] {
  const cloned = packages.map(clonePackage);
  const plannedVersions = new Map(plan.map((item) => [item.name, item.toVersion] as const));

  for (const pkg of cloned) {
    const nextVersion = plannedVersions.get(pkg.name);
    if (!nextVersion) continue;
    pkg.version = nextVersion;
    pkg.pkg.version = nextVersion;
  }

  return cloned;
}

/**
 * Build a dry-run preview table that combines bump and publish status.
 */
export function buildReleasePreviewRows(
  allPackages: readonly PackageInfo[],
  publishPackages: readonly PackageInfo[],
  bumpPlan: readonly AutoBumpPlanItem[],
): ReleasePreviewRow[] {
  const bumpByName = new Map(bumpPlan.map((item) => [item.name, item] as const));
  const publishNames = new Set(publishPackages.map((pkg) => pkg.name));

  return allPackages.map((pkg) => {
    const bump = bumpByName.get(pkg.name);
    const publish = publishNames.has(pkg.name);
    const status: ReleasePreviewRow["status"] = bump
      ? "will bump"
      : publish
        ? "will publish"
        : "skip";

    return {
      name: pkg.name,
      currentVersion: pkg.version,
      nextVersion: bump ? bump.toVersion : publish ? pkg.version : "—",
      bump: Boolean(bump),
      publish,
      status,
    };
  });
}
