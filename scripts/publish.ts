import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCLI } from "./lib/cli";
import { getRegistryVersion, setRoot } from "./lib/npm";
import { getPackages } from "./lib/packages";
import { buildDepGraph, topoSort, collectDependencies } from "./lib/deps";
import { updateChangelog } from "./lib/changelog";
import { validatePackage, validateRootConsistency } from "./lib/validate";
import { tagAndRelease } from "./lib/git";
import { isStringArray } from "./lib/guards";
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

/** Check whether a package should be published (version mismatch or not yet published). */
function shouldPublish(version: string, registryVersion: string | null): boolean {
  return version !== registryVersion;
}

/**
 * Temporarily replace `workspace:*` dependencies in a package's
 * `package.json` with concrete versions from the workspace.
 * Returns a restore function that reverts the file to its original
 * content, or `undefined` when no changes were necessary.
 */
function rewriteWorkspaceDeps(
  pkg: PackageInfo,
  nameMap: Map<string, PackageInfo>,
): (() => void) | undefined {
  const deps = pkg.pkg.dependencies;
  if (!deps) return;

  const replacements: Record<string, string> = {};
  for (const [depName, version] of Object.entries(deps)) {
    if (version !== "workspace:*") continue;
    const depPkg = nameMap.get(depName);
    if (depPkg) {
      replacements[depName] = depPkg.version;
    }
  }

  if (Object.keys(replacements).length === 0) return;

  const pkgJsonPath = join(pkg.path, "package.json");
  const original = readFileSync(pkgJsonPath, "utf8");
  const parsed = JSON.parse(original);

  for (const [depName, realVersion] of Object.entries(replacements)) {
    parsed.dependencies[depName] = `^${realVersion}`;
  }

  writeFileSync(pkgJsonPath, JSON.stringify(parsed, null, 2) + "\n");
  return () => {
    writeFileSync(pkgJsonPath, original);
  };
}

/**
 * Publish a single package. On success, record the version and immediately
 * create a git tag + GitHub Release so metadata is never left behind.
 *
 * Workspace `package.json` files are temporarily rewritten so that nested
 * bundled dependencies do not contain `workspace:*` in the published tarball.
 */
function publishOne(
  pkg: PackageInfo,
  publishedVersions: Map<string, string>,
  nameMap: Map<string, PackageInfo>,
): void {
  const restores: (() => void)[] = [];

  // Rewrite this package's own workspace deps.
  const restoreSelf = rewriteWorkspaceDeps(pkg, nameMap);
  if (restoreSelf) restores.push(restoreSelf);

  // If this is the root package, also rewrite any bundled workspace deps so
  // they are packed with concrete versions instead of `workspace:*`.
  if (pkg.isRoot) {
    const bundled: string[] = isStringArray(pkg.pkg.bundledDependencies)
      ? pkg.pkg.bundledDependencies
      : [];
    for (const depName of bundled) {
      const depPkg = nameMap.get(depName);
      if (!depPkg) continue;
      const restoreBundled = rewriteWorkspaceDeps(depPkg, nameMap);
      if (restoreBundled) restores.push(restoreBundled);
    }
  }

  if (pkg.isRoot) {
    console.log(`🚀 Publishing root package ${pkg.name}@${pkg.version}...`);
  } else {
    console.log(`🚀 Publishing ${pkg.name}@${pkg.version}...`);
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
      process.exit(1);
    }
  } finally {
    for (const restore of restores) {
      restore();
    }
  }
}

/**
 * Ensure every bundled dependency has a concrete version in
 * `publishedVersions`. Queries the npm registry for any missing entries
 * so the CHANGELOG never shows `workspace:*`.
 */
function resolveBundledVersions(
  rootPkg: PackageInfo,
  publishedVersions: Map<string, string>,
): void {
  const bundled: string[] = isStringArray(rootPkg.pkg.bundledDependencies)
    ? rootPkg.pkg.bundledDependencies
    : [];
  for (const dep of bundled) {
    if (publishedVersions.has(dep)) continue;
    const registryVersion = getRegistryVersion(dep);
    if (registryVersion) {
      publishedVersions.set(dep, registryVersion);
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
 *   6. Update `CHANGELOG.md` after the root package is published.
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
    publishOne(pkg, publishedVersions, nameMap);
  }

  // Generate changelog after root package is published
  if (rootPkg && publishedVersions.has(rootPkg.name)) {
    resolveBundledVersions(rootPkg, publishedVersions);
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

  console.log("🎉 All packages published successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
