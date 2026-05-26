import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCLI } from "./lib/cli";
import { getRegistryVersion, setRoot } from "./lib/npm";
import { getPackages } from "./lib/packages";
import { buildDepGraph } from "./lib/deps";
import { validatePackage, validateRootConsistency } from "./lib/validate";
import { tagAndRelease } from "./lib/git";
import { createReleasePlan } from "./lib/release-plan";
import { stageBundledBuildArtifacts } from "./lib/build-artifact-stage";
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

  if (pkg.isRoot) {
    console.log(`🚀 Publishing root package ${pkg.name}@${pkg.version}...`);
  } else {
    console.log(`🚀 Publishing ${pkg.name}@${pkg.version}...`);
  }

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
    // Network timeout can occur after the registry has already accepted the
    // package. Verify before treating it as a real failure.
    const afterVersion = getRegistryVersion(pkg.name);
    if (afterVersion === pkg.version) {
      console.log(
        `⚠️ Publish timed out but ${pkg.name}@${pkg.version} is already on registry. Continuing...\n`,
      );
      publishedVersions.set(pkg.name, pkg.version);
      tagAndRelease(root, pkg.name, pkg.version);
    } else {
      console.error(`❌ Failed to publish ${pkg.name}`);
      for (const restore of restores) {
        restore();
      }
      process.exit(1);
    }
  } finally {
    for (const restore of restores) {
      restore();
    }
  }
}

/**
 * Orchestrate the release:
 *
 *   1. Detect packages whose local version differs from the registry.
 *   2. If explicit targets were given, narrow to their dependency closure.
 *   3. Validate every package's manifest before publishing.
 *   4. Topologically sort so dependencies publish first.
 *   5. Publish each package and immediately tag + release it.
 *   6. Create git tag + GitHub Release for every published package.
 */
async function main(): Promise<void> {
  const packages = getPackages(root);
  const { nameMap } = buildDepGraph(packages);
  const result = createReleasePlan({
    packages,
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

  if (sortedToPublish.length === 0) {
    console.log("✅ All packages are up to date. Nothing to publish.");
    return;
  }

  console.log(`📦 Packages to publish (${sortedToPublish.length}):`);
  for (const pkg of result.plan.packages) {
    const registryVersion = result.plan.registryVersions.get(pkg.name);
    console.log(`  ${pkg.name}@${pkg.version} (registry: ${registryVersion || "not published"})`);
  }

  // Pre-publish validation
  const validationErrors = [];
  for (const name of toPublish) {
    const pkg = nameMap.get(name);
    if (!pkg) continue;
    validationErrors.push(...validatePackage(pkg));
  }
  const rootPkg = packages.find((p) => p.isRoot);
  if (rootPkg && toPublish.has(rootPkg.name)) {
    validationErrors.push(
      ...validateRootConsistency(
        rootPkg,
        packages.filter((p) => !p.isRoot),
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
  execSync("oxnode scripts/build.ts", { cwd: root, stdio: "inherit" });
  console.log("");

  const publishedVersions = new Map<string, string>();
  for (const name of sortedToPublish) {
    const pkg = nameMap.get(name);
    if (!pkg) continue;
    publishOne(pkg, publishedVersions, nameMap);
  }

  console.log("🎉 All packages published successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
