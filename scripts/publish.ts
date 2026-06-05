import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planAutoBumps } from "./lib/auto-bump";
import { applyAutoBumpPlanToPackages, buildReleasePreviewRows } from "./lib/release-preview";
import { parseCLI } from "./lib/cli";
import { buildDepGraph, collectDependencies } from "./lib/deps";
import { commit, hasPathChangesSinceRef, pushCurrentBranch, tagAndRelease } from "./lib/git";
import { getRegistryVersion, setRoot } from "./lib/npm";
import { getPackages } from "./lib/packages";
import { createReleasePlan } from "./lib/release-plan";
import { stageBundledBuildArtifacts } from "./lib/build-artifact-stage";
import { validatePackage, validateRootConsistency } from "./lib/validate";
import type { PackageInfo } from "./lib/types";

/** Repository root absolute path. */
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
setRoot(root);

const { flags, positionals } = parseCLI();

const DRY_RUN = flags.has("dry-run");
const ALL = flags.has("all") || flags.has("a");
const ACCESS = typeof flags.get("access") === "string" ? String(flags.get("access")) : "public";
const OTP = typeof flags.get("otp") === "string" ? String(flags.get("otp")) : undefined;

// Package target(s) from -p / --package flag.
let TARGETS: string[] = [];
const pkgFlag = flags.get("package") ?? flags.get("p");
if (pkgFlag) {
  TARGETS = String(pkgFlag)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
} else if (positionals.length > 0) {
  // Back-compat: bare positional args are also treated as targets.
  TARGETS = positionals;
}

// If neither --all nor --package/positional targets were provided,
// default to all out-of-date packages for backwards compatibility.
const PUBLISH_ALL = ALL || TARGETS.length === 0;

function latestPublishedTag(pkg: PackageInfo): string | null {
  try {
    execSync(`git rev-parse --verify refs/tags/${pkg.name}@${pkg.version}`, {
      cwd: root,
      stdio: "pipe",
    });
    return `${pkg.name}@${pkg.version}`;
  } catch {
    return null;
  }
}

function packageReleasePaths(pkg: PackageInfo, related: readonly PackageInfo[]): string[] {
  const paths = new Set<string>([
    relative(root, resolve(pkg.path, "package.json")),
    relative(root, resolve(pkg.path, "README.md")),
  ]);

  if (pkg.isRoot) {
    paths.add(relative(root, resolve(root, "prompts")));
    paths.add(relative(root, resolve(root, "skills")));
    paths.add(relative(root, resolve(root, "themes")));
  } else {
    paths.add(relative(root, resolve(pkg.path, "src")));
    paths.add(relative(root, resolve(pkg.path, "tsdown.config.ts")));
    paths.add(relative(root, resolve(pkg.path, "vitest.config.ts")));
  }

  for (const dep of related) {
    if (dep.name === pkg.name) continue;
    paths.add(relative(root, resolve(dep.path, "package.json")));
    paths.add(relative(root, resolve(dep.path, "README.md")));
    paths.add(relative(root, resolve(dep.path, "src")));
    paths.add(relative(root, resolve(dep.path, "tsdown.config.ts")));
    paths.add(relative(root, resolve(dep.path, "vitest.config.ts")));
  }

  return [...paths];
}

function updatePackageVersion(pkg: PackageInfo, nextVersion: string): void {
  const pkgJsonPath = resolve(pkg.path, "package.json");
  const data: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (typeof data !== "object" || data === null || !("version" in data)) {
    throw new Error(`Invalid package.json: ${pkgJsonPath}`);
  }

  const updated = { ...(data as Record<string, unknown>), version: nextVersion };
  writeFileSync(pkgJsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  pkg.version = nextVersion;
  pkg.pkg.version = nextVersion;
}

function collectWorkspaceRelated(
  pkg: PackageInfo,
  nameMap: ReadonlyMap<string, PackageInfo>,
): PackageInfo[] {
  const names = collectDependencies(
    pkg.name,
    nameMap as Map<string, PackageInfo>,
    new Set<string>(),
  );
  return [...names]
    .map((name) => nameMap.get(name))
    .filter((value): value is PackageInfo => Boolean(value));
}

function createAutoBumpPlan(
  packages: readonly PackageInfo[],
  nameMap: ReadonlyMap<string, PackageInfo>,
) {
  return planAutoBumps(packages, {
    getRegistryVersion,
    hasPublishedTag: (pkg) => Boolean(latestPublishedTag(pkg)),
    hasChangedInputs: (pkg) => {
      const related = collectWorkspaceRelated(pkg, nameMap);
      return hasPathChangesSinceRef(
        root,
        `${pkg.name}@${pkg.version}`,
        packageReleasePaths(pkg, related),
      );
    },
  });
}

function applyAutoBumpPlan(
  plan: readonly { name: string; fromVersion: string; toVersion: string }[],
  nameMap: ReadonlyMap<string, PackageInfo>,
): void {
  if (plan.length === 0) return;

  const bumped: string[] = [];
  for (const item of plan) {
    const pkg = nameMap.get(item.name);
    if (!pkg) continue;
    updatePackageVersion(pkg, item.toVersion);
    bumped.push(resolve(pkg.path, "package.json"));
  }

  const commitMessage = `release: bump ${plan.map((item) => `${item.name}@${item.toVersion}`).join(", ")}`;
  execSync(`git add -- ${bumped.map((path) => JSON.stringify(path)).join(" ")}`, {
    cwd: root,
    stdio: "pipe",
  });
  commit(root, commitMessage);
  pushCurrentBranch(root);
}

/**
 * Publish a single package. On success, record the version and immediately
 * create a git tag + GitHub Release so metadata is never left behind.
 *
 * Child packages are published from their `dist/` directory (via
 * publishConfig.directory). The root package has its bundled workspace deps
 * temporarily swapped with clean dist/ copies before publishing.
 */
function publishOne(
  pkg: PackageInfo,
  publishedVersions: Map<string, string>,
  nameMap: Map<string, PackageInfo>,
): void {
  const restores: (() => void)[] = [];

  if (pkg.isRoot) {
    const result = stageBundledBuildArtifacts({ root, rootPkg: pkg, nameMap });
    if (!result.ok) {
      console.error(result.message);
      process.exit(1);
    }
    restores.push(...result.restores);
  }

  console.log(
    pkg.isRoot
      ? `🚀 Publishing root package ${pkg.name}@${pkg.version}...`
      : `🚀 Publishing ${pkg.name}@${pkg.version}...`,
  );

  try {
    const otpFlag = OTP ? ` --otp ${OTP}` : "";
    const env = OTP ? { ...process.env, PNPM_CONFIG_OTP: OTP } : undefined;
    execSync(`pnpm publish --no-git-checks --access ${ACCESS}${otpFlag}`, {
      cwd: pkg.path,
      stdio: "inherit",
      env,
      timeout: 120_000,
    });
    console.log(`✅ Published ${pkg.name}@${pkg.version}\n`);
    publishedVersions.set(pkg.name, pkg.version);
    tagAndRelease(root, pkg.name, pkg.version);
  } catch {
    const afterVersion = getRegistryVersion(pkg.name);
    if (afterVersion === pkg.version) {
      console.log(
        `⚠️ Publish timed out but ${pkg.name}@${pkg.version} is already on registry. Continuing...\n`,
      );
      publishedVersions.set(pkg.name, pkg.version);
      tagAndRelease(root, pkg.name, pkg.version);
    } else {
      console.error(`❌ Failed to publish ${pkg.name}`);
      for (const restore of restores) restore();
      process.exit(1);
    }
  } finally {
    for (const restore of restores) restore();
  }
}

async function main(): Promise<void> {
  const packages = getPackages(root);
  const { nameMap } = buildDepGraph(packages);
  const autoBumpPlan = createAutoBumpPlan(packages, nameMap);

  if (!DRY_RUN) {
    applyAutoBumpPlan(autoBumpPlan, nameMap);
  }

  const publishPackages = DRY_RUN ? applyAutoBumpPlanToPackages(packages, autoBumpPlan) : packages;
  const result = createReleasePlan({
    packages: publishPackages,
    targets: TARGETS,
    publishAll: PUBLISH_ALL,
    getRegistryVersion,
  });

  if (!result.ok) {
    console.error(`❌ Unknown package: ${result.target}`);
    process.exit(1);
  }

  const sortedToPublish = result.plan.packages.map((pkg) => pkg.name);
  const toPublish = new Set(sortedToPublish);

  if (DRY_RUN) {
    const previewRows = buildReleasePreviewRows(packages, result.plan.packages, autoBumpPlan);
    const statusLabel = (status: string): string => {
      if (status === "will bump") return "bump";
      if (status === "will publish") return "publish";
      return "skip";
    };
    const colorize = (value: string, status: string): string => {
      if (status === "will bump") return `\x1b[1;35m${value}\x1b[0m`;
      if (status === "will publish") return `\x1b[1;36m${value}\x1b[0m`;
      return `\x1b[90m${value}\x1b[0m`;
    };

    console.log("🧭 Release preview (dependency order):");
    if (autoBumpPlan.length > 0) {
      console.log("  bump candidates:");
      for (const item of autoBumpPlan) {
        console.log(`    ${item.name}: ${item.fromVersion} → ${item.toVersion}`);
      }
    }
    console.log(
      "  status    | package                               | package version               | publish version",
    );
    console.log(
      "  ----------|--------------------------------------|-------------------------------|----------------",
    );
    for (const row of previewRows) {
      const packageText = row.name.padEnd(38, " ");
      const currentText = row.currentVersion;
      const releaseText = row.nextVersion;
      const packageVersionText = currentText.padEnd(29, " ");
      const releaseVersionText = releaseText.padEnd(16, " ");
      const actionColumn = colorize(statusLabel(row.status).padEnd(10, " "), row.status);
      const packageColumn = colorize(packageText, row.status);
      const packageVersionColumn = colorize(packageVersionText, row.status);
      const releaseVersionColumn = colorize(releaseVersionText, row.status);
      console.log(
        `  ${actionColumn} | ${packageColumn} | ${packageVersionColumn} | ${releaseVersionColumn}`,
      );
    }
  }

  if (sortedToPublish.length === 0) {
    console.log("✅ All packages are up to date. Nothing to publish.");
    return;
  }

  if (!DRY_RUN) {
    console.log(`📦 Packages to publish (${sortedToPublish.length}):`);
    for (const pkg of result.plan.packages) {
      const registryVersion = result.plan.registryVersions.get(pkg.name);
      console.log(`  ${pkg.name}@${pkg.version} (registry: ${registryVersion || "not published"})`);
    }
  }

  const validationErrors: Array<{ pkg: string; field: string; message: string }> = [];
  for (const name of toPublish) {
    const pkg = nameMap.get(name);
    if (!pkg) continue;
    validationErrors.push(...validatePackage(pkg));
  }
  const rootPkg = packages.find((pkg) => pkg.isRoot);
  if (rootPkg && toPublish.has(rootPkg.name)) {
    validationErrors.push(
      ...validateRootConsistency(
        rootPkg,
        packages.filter((pkg) => !pkg.isRoot),
      ),
    );
  }
  if (validationErrors.length > 0) {
    console.error("\n❌ Package validation failed:");
    for (const err of validationErrors) {
      console.error(`  ${err.pkg}: ${err.field} ${err.message}`);
    }
    console.error("");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n🏃 Dry run mode. No packages were actually published.");
    return;
  }

  console.log("🔨 Building packages...");
  execSync("pnpm run build", { cwd: root, stdio: "inherit" });
  console.log("");

  const publishedVersions = new Map<string, string>();
  for (const name of sortedToPublish) {
    const pkg = nameMap.get(name);
    if (!pkg) continue;
    publishOne(pkg, publishedVersions, nameMap);
  }

  console.log("🎉 All packages published successfully!");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
