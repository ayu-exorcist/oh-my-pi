import type { PackageInfo } from "./types";
import { bumpPatchVersion } from "./version";

export interface AutoBumpPlanItem {
  readonly name: string;
  readonly fromVersion: string;
  readonly toVersion: string;
}

export interface AutoBumpDependencies {
  readonly getRegistryVersion: (name: string) => string | null;
  readonly hasPublishedTag: (pkg: PackageInfo) => boolean;
  readonly hasChangedInputs: (pkg: PackageInfo) => boolean;
}

/**
 * Decide which already-published packages need a patch bump before release.
 *
 * A package is bumped only when:
 * - the registry already has the current version,
 * - the corresponding release tag exists, and
 * - the release inputs have changed since that tagged release.
 */
export function planAutoBumps(
  packages: readonly PackageInfo[],
  dependencies: AutoBumpDependencies,
): AutoBumpPlanItem[] {
  const plan: AutoBumpPlanItem[] = [];

  for (const pkg of packages) {
    const registryVersion = dependencies.getRegistryVersion(pkg.name);
    if (registryVersion !== pkg.version) continue;
    if (!dependencies.hasPublishedTag(pkg)) continue;
    if (!dependencies.hasChangedInputs(pkg)) continue;

    plan.push({
      name: pkg.name,
      fromVersion: pkg.version,
      toVersion: bumpPatchVersion(pkg.version),
    });
  }

  return plan;
}
