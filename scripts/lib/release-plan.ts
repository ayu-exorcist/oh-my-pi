import type { PackageInfo } from "./types";

export interface ReleasePlan {
  readonly packages: readonly PackageInfo[];
  readonly registryVersions: ReadonlyMap<string, string | null>;
}

export interface CreateReleasePlanOptions {
  readonly packages: readonly PackageInfo[];
  readonly targets: readonly string[];
  readonly publishAll: boolean;
  readonly getRegistryVersion: (name: string) => string | null;
}

export type ReleasePlanResult =
  | { readonly ok: true; readonly plan: ReleasePlan }
  | { readonly ok: false; readonly reason: "unknown-target"; readonly target: string };

function shouldPublish(version: string, registryVersion: string | null): boolean {
  return version !== registryVersion;
}

export function collectDependencies(
  target: string,
  packagesByName: ReadonlyMap<string, PackageInfo>,
  visited: Set<string>,
): Set<string> {
  if (visited.has(target)) return visited;
  visited.add(target);
  const pkg = packagesByName.get(target);
  const deps = pkg?.pkg.dependencies || {};
  for (const depName of Object.keys(deps)) {
    if (packagesByName.has(depName)) collectDependencies(depName, packagesByName, visited);
  }
  return visited;
}

function collectAllowedTargets(
  options: CreateReleasePlanOptions,
  packagesByName: ReadonlyMap<string, PackageInfo>,
): Set<string> {
  const allowed = new Set<string>();
  for (const target of options.targets) {
    for (const dep of collectDependencies(target, packagesByName, new Set<string>())) {
      allowed.add(dep);
    }
  }
  return allowed;
}

function isAfterDependencies(
  candidate: PackageInfo,
  packagesByName: ReadonlyMap<string, PackageInfo>,
  planned: readonly PackageInfo[],
  pending: ReadonlySet<string>,
): boolean {
  const deps = collectDependencies(candidate.name, packagesByName, new Set<string>());
  deps.delete(candidate.name);
  for (const depName of deps) {
    if (pending.has(depName) && !planned.some((pkg) => pkg.name === depName)) {
      return false;
    }
  }
  return true;
}

function orderByDependencies(
  packages: readonly PackageInfo[],
  packagesByName: ReadonlyMap<string, PackageInfo>,
): readonly PackageInfo[] {
  const pending = new Set(packages.map((pkg) => pkg.name));
  const planned: PackageInfo[] = [];

  while (pending.size > 0) {
    const before = pending.size;
    for (const pkg of packages) {
      if (!pending.has(pkg.name)) continue;
      if (!isAfterDependencies(pkg, packagesByName, planned, pending)) continue;
      planned.push(pkg);
      pending.delete(pkg.name);
      break;
    }
    if (pending.size === before) return planned;
  }

  return planned;
}

export function createReleasePlan(options: CreateReleasePlanOptions): ReleasePlanResult {
  const packagesByName = new Map(options.packages.map((pkg) => [pkg.name, pkg]));

  for (const target of options.targets) {
    if (!packagesByName.has(target)) {
      return { ok: false, reason: "unknown-target", target };
    }
  }

  const allowed = options.publishAll ? undefined : collectAllowedTargets(options, packagesByName);
  const registryVersions = new Map<string, string | null>();
  const selected: PackageInfo[] = [];

  for (const pkg of options.packages) {
    if (allowed && !allowed.has(pkg.name)) continue;
    const registryVersion = options.getRegistryVersion(pkg.name);
    if (!shouldPublish(pkg.version, registryVersion)) continue;
    registryVersions.set(pkg.name, registryVersion);
    selected.push(pkg);
  }

  return {
    ok: true,
    plan: {
      packages: orderByDependencies(selected, packagesByName),
      registryVersions,
    },
  };
}
