import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCLI } from "./lib/cli";
import { getRegistryVersion, setRoot } from "./lib/npm";
import { getPackages } from "./lib/packages";
import { buildDepGraph, topoSort, collectDependencies } from "./lib/deps";
import { updateChangelog } from "./lib/changelog";
import { validatePackage, validateRootConsistency } from "./lib/validate";
import { createTags, pushTags, createReleases } from "./lib/git";
import { isStringArray } from "./lib/guards";

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

/** Check whether a package should be published (version mismatch or not yet published). */
function shouldPublish(version: string, registryVersion: string | null): boolean {
  return version !== registryVersion;
}

/**
 * Orchestrate the release:
 *
 *   1. Detect packages whose local version differs from the registry.
 *   2. If explicit targets were given, narrow to their dependency closure.
 *   3. Validate every package's manifest before publishing.
 *   4. Topologically sort so dependencies publish first.
 *   5. Run `pnpm publish` for each package.
 *   6. Update `CHANGELOG.md` after the root package is published.
 *   7. Create and push git tags, then open GitHub Releases.
 */
async function main(): Promise<void> {
  const packages = getPackages(root);
  const { graph, inDegree, nameMap } = buildDepGraph(packages);

  // Step 1 — detect version drift
  const needsPublish = new Map<string, string | null>();
  for (const pkg of packages) {
    const registryVersion = getRegistryVersion(pkg.name);
    if (shouldPublish(pkg.version, registryVersion)) {
      needsPublish.set(pkg.name, registryVersion);
    }
  }

  let toPublish = new Set(needsPublish.keys());

  if (!PUBLISH_ALL) {
    // -p / --package was explicitly set; -a was not.
    for (const target of TARGETS) {
      if (!nameMap.has(target)) {
        console.error(`❌ Unknown package: ${target}`);
        process.exit(1);
      }
    }

    const allowed = new Set<string>();
    for (const target of TARGETS) {
      for (const dep of collectDependencies(target, nameMap)) {
        allowed.add(dep);
      }
    }

    // Narrow existing drift list to allowed packages, then supplement
    // any allowed package that has never been published.
    toPublish = new Set([...toPublish].filter((n) => allowed.has(n)));
    for (const name of allowed) {
      if (toPublish.has(name)) continue;
      const registryVersion = getRegistryVersion(name);
      if (registryVersion === null) {
        toPublish.add(name);
        needsPublish.set(name, null);
      }
    }
  }

  if (toPublish.size === 0) {
    console.log("✅ All packages are up to date. Nothing to publish.");
    return;
  }

  const sorted = topoSort([...nameMap.keys()], graph, inDegree);
  const sortedToPublish = sorted.filter((n) => toPublish.has(n));

  console.log(`📦 Packages to publish (${sortedToPublish.length}):`);
  for (const name of sortedToPublish) {
    const pkg = nameMap.get(name);
    const registryVersion = needsPublish.get(name) ?? getRegistryVersion(name);
    console.log(`  ${name}@${pkg?.version} (registry: ${registryVersion || "not published"})`);
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

  console.log("");
  const publishedVersions = new Map<string, string>();
  for (const name of sortedToPublish) {
    const pkg = nameMap.get(name);
    if (!pkg) continue;

    if (pkg.isRoot) {
      console.log(`🚀 Publishing root package ${name}@${pkg.version}...`);
    } else {
      console.log(`🚀 Publishing ${name}@${pkg.version}...`);
    }

    try {
      const otpFlag = OTP ? ` --otp ${OTP}` : "";
      const env = OTP ? { ...process.env, PNPM_CONFIG_OTP: OTP } : undefined;
      execSync(`pnpm publish --access ${ACCESS}${otpFlag}`, {
        cwd: pkg.path,
        stdio: "inherit",
        env,
        timeout: 120_000,
      });
      console.log(`✅ Published ${name}@${pkg.version}\n`);
      publishedVersions.set(name, pkg.version);
    } catch {
      // Network timeout can occur after the registry has already accepted the
      // package. Verify before treating it as a real failure.
      const afterVersion = getRegistryVersion(name);
      if (afterVersion === pkg.version) {
        console.log(
          `⚠️ Publish timed out but ${name}@${pkg.version} is already on registry. Continuing...\n`,
        );
        publishedVersions.set(name, pkg.version);
      } else {
        console.error(`❌ Failed to publish ${name}`);
        process.exit(1);
      }
    }
  }

  // Generate changelog after root package is published
  if (rootPkg && publishedVersions.has(rootPkg.name)) {
    updateChangelog(root, rootPkg, publishedVersions);
  } else if (rootPkg) {
    const bundled: string[] = isStringArray(rootPkg.pkg.bundledDependencies)
      ? rootPkg.pkg.bundledDependencies
      : [];
    const publishedBundled = bundled.filter((name) => publishedVersions.has(name));
    if (publishedBundled.length > 0) {
      console.log(
        `⚠️ Bundled deps published but root unchanged. Bump ${rootPkg.name} and re-run to update CHANGELOG.`,
      );
      console.log(`   Published: ${publishedBundled.join(", ")}\n`);
    }
  }

  // Tags + Releases
  const newTags = createTags(root, publishedVersions);
  pushTags(root, newTags);
  createReleases(root, newTags);

  console.log("🎉 All packages published successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
