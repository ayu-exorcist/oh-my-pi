#!/usr/bin/env oxnode
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord } from "@ayulab/runtime-core";
import { parseCLI } from "./lib/cli";
import { parseReleaseRunOptions, rejectUnsupportedReleaseArgs } from "./lib/release-args";
import { buildDepGraph, collectDependencies } from "./lib/deps";
import { hasPathChangesSinceRef } from "./lib/git";
import { getPackages, getReleaseInputWorkspacePackages } from "./lib/packages";
import { validatePackage, validateRootConsistency } from "./lib/validate";
import type { PackageInfo, ValidationError } from "./lib/types";

/** Repository root absolute path. */
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export function packageReleasePaths(pkg: PackageInfo, related: readonly PackageInfo[]): string[] {
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

export function findUncommittedReleasePackages(
  scopedPackages: readonly PackageInfo[],
  inputNameMap: ReadonlyMap<string, PackageInfo>,
): string[] {
  const dirtyPackages: string[] = [];

  for (const pkg of scopedPackages) {
    const related = collectWorkspaceRelated(pkg, inputNameMap);
    if (hasPathChangesSinceRef(root, "HEAD", packageReleasePaths(pkg, related))) {
      dirtyPackages.push(pkg.name);
    }
  }

  return dirtyPackages;
}

export function ensureReleaseScopeIsCommitted(
  scopedPackages: readonly PackageInfo[],
  inputNameMap: ReadonlyMap<string, PackageInfo>,
): boolean {
  const dirtyPackages = findUncommittedReleasePackages(scopedPackages, inputNameMap);
  if (dirtyPackages.length === 0) return true;

  console.error(
    `❌ Release aborted: uncommitted changes detected for ${dirtyPackages.join(", ")}. Commit first, then rerun release.`,
  );
  /* c8 ignore next */
  process.exit(1);
}

function collectValidationErrors(packages: readonly PackageInfo[]): ValidationError[] {
  const validationErrors: ValidationError[] = [];
  for (const pkg of packages) {
    validationErrors.push(...validatePackage(pkg));
  }

  const rootPkg = packages.find((pkg) => pkg.isRoot);
  if (rootPkg) {
    validationErrors.push(
      ...validateRootConsistency(
        rootPkg,
        packages.filter((pkg) => !pkg.isRoot),
      ),
    );
  }

  return validationErrors;
}

function ensureReleaseValidation(packages: readonly PackageInfo[]): boolean {
  const validationErrors = collectValidationErrors(packages);
  if (validationErrors.length === 0) return true;

  console.error("\n❌ Package validation failed:");
  for (const err of validationErrors) {
    console.error(`  ${err.pkg}: ${err.field} ${err.message}`);
  }
  console.error("");
  /* c8 ignore next */
  process.exit(1);
}

export function stripRootManifestForPublish(rootDir = root): () => void {
  const packageJsonPath = join(rootDir, "package.json");
  const original = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(original);

  if (!isRecord(parsed)) {
    throw new Error("package.json must be an object");
  }

  const manifest: Record<string, unknown> = { ...parsed };

  delete manifest.scripts;
  delete manifest.devDependencies;
  delete manifest.engines;
  delete manifest["simple-git-hooks"];

  const publishConfig = manifest.publishConfig;
  if (isRecord(publishConfig)) {
    const cleanedPublishConfig = { ...publishConfig };
    delete cleanedPublishConfig.scripts;
    manifest.publishConfig = cleanedPublishConfig;
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return () => writeFileSync(packageJsonPath, original);
}

function runChangesetsPublish(otp: string | undefined): void {
  const otpFlag = otp ? ` --otp ${otp}` : "";
  const restoreRootManifest = stripRootManifestForPublish();
  try {
    execSync(`pnpm changeset publish${otpFlag}`, { cwd: root, stdio: "inherit" });
  } finally {
    restoreRootManifest();
  }
}

export async function publishPackages(options: {
  dryRun: boolean;
  otp: string | undefined;
}): Promise<void> {
  const { dryRun, otp } = options;

  const packages = getPackages(root);
  const releaseInputPackages = getReleaseInputWorkspacePackages(root);
  const { nameMap: inputNameMap } = buildDepGraph([
    ...releaseInputPackages,
    ...packages.filter((pkg) => pkg.isRoot),
  ]);

  if (!dryRun && !ensureReleaseScopeIsCommitted(packages, inputNameMap)) return;
  if (!ensureReleaseValidation(packages)) return;

  console.log("🔨 Building packages...");
  execSync("pnpm run build", { cwd: root, stdio: "inherit" });
  console.log("");

  if (dryRun) {
    execSync("pnpm changeset status --verbose", { cwd: root, stdio: "inherit" });
    console.log("\n🏃 Dry run mode. No packages were published and no tags were created.");
    return;
  }

  runChangesetsPublish(otp);
  console.log("🎉 Changesets publish completed successfully!");
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : null;
if (entrypoint === fileURLToPath(import.meta.url)) {
  const { flags, positionals } = parseCLI();
  if (rejectUnsupportedReleaseArgs(flags, positionals)) {
    const { dryRun, otp } = parseReleaseRunOptions(flags);
    void publishPackages({ dryRun, otp }).catch((err: unknown) => {
      console.error(err);
      /* c8 ignore next */
      process.exit(1);
    });
  }
}
