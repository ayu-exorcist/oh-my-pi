#!/usr/bin/env oxnode
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord, isStringArray } from "@ayulab/runtime-core";
import { parseCLI } from "./lib/cli";
import { parseReleaseRunOptions, rejectUnsupportedReleaseArgs } from "./lib/release-args";
import { buildDepGraph, collectDependencies } from "./lib/deps";
import { hasPathChangesSinceRef } from "./lib/git";
import { getPackages, getReleaseInputWorkspacePackages } from "./lib/packages";
import { validatePackage, validateRootConsistency } from "./lib/validate";
import type { PackageInfo, ValidationError } from "./lib/types";

/** Repository root absolute path. */
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(import.meta.url);
const changesetCliPath = resolve(
  dirname(require.resolve("@changesets/cli/package.json")),
  "bin.js",
);

export function packageReleasePaths(pkg: PackageInfo, related: readonly PackageInfo[]): string[] {
  const paths = new Set<string>([
    relative(root, resolve(pkg.path, "package.json")),
    relative(root, resolve(pkg.path, "README.md")),
  ]);

  if (pkg.isRoot) {
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
  const names = collectDependencies(pkg.name, nameMap, new Set<string>());
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

export function buildRootPublishManifest(parsed: unknown): Record<string, unknown> {
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

  return manifest;
}

function runCommand(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, [...args], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status === 0) return;

  const detail = result.signal ? `signal ${result.signal}` : `exit code ${String(result.status)}`;
  throw new Error(`${command} ${args.join(" ")} failed with ${detail}`);
}

function runChangeset(args: readonly string[], cwd: string): void {
  runCommand(process.execPath, [changesetCliPath, ...args], cwd);
}

function copyIfExists(sourceRoot: string, targetRoot: string, relativePath: string): void {
  const source = join(sourceRoot, relativePath);
  if (!existsSync(source)) return;

  const target = join(targetRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function configurePublishWorkspace(publishRoot: string): void {
  const workspacePath = join(publishRoot, "pnpm-workspace.yaml");
  const existing = existsSync(workspacePath) ? readFileSync(workspacePath, "utf8") : "";
  const withoutNodeLinker = existing.replace(/^nodeLinker:[^\r\n]*(?:\r?\n)?/m, "");
  const separator = withoutNodeLinker.length === 0 || withoutNodeLinker.endsWith("\n") ? "" : "\n";
  writeFileSync(workspacePath, `${withoutNodeLinker}${separator}nodeLinker: hoisted\n`);
}

function writeRootPublishManifest(rootDir: string, publishRoot: string): void {
  const parsed: unknown = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const manifest = buildRootPublishManifest(parsed);
  writeFileSync(join(publishRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function copyWorkspacePackageForPublish(
  rootDir: string,
  publishRoot: string,
  pkg: PackageInfo,
): void {
  const packagePath = relative(rootDir, pkg.path);
  copyIfExists(rootDir, publishRoot, join(packagePath, "package.json"));
  copyIfExists(rootDir, publishRoot, join(packagePath, "README.md"));
  copyIfExists(rootDir, publishRoot, join(packagePath, "dist"));
}

function packageNodeModulesPath(rootDir: string, packageName: string): string {
  return join(rootDir, "node_modules", ...packageName.split("/"));
}

function hydrateRootBundledWorkspaceDependencies(
  rootDir: string,
  publishRoot: string,
  workspacePackages: readonly PackageInfo[],
): void {
  const parsed: unknown = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  if (!isRecord(parsed) || !isStringArray(parsed.bundledDependencies)) return;

  const workspaceByName = new Map(workspacePackages.map((pkg) => [pkg.name, pkg]));
  for (const depName of parsed.bundledDependencies) {
    const workspacePackage = workspaceByName.get(depName);
    if (!workspacePackage) continue;

    const packagePath = relative(rootDir, workspacePackage.path);
    const distPackageJson = join(publishRoot, packagePath, "dist", "package.json");
    if (!existsSync(distPackageJson)) {
      throw new Error(
        `Cannot bundle ${depName}: missing ${relative(rootDir, resolve(workspacePackage.path, "dist", "package.json"))}. Run pnpm run build first.`,
      );
    }

    const target = packageNodeModulesPath(publishRoot, depName);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(publishRoot, packagePath, "dist"), target, { recursive: true });
  }
}

export function createPublishWorkspace(
  rootDir = root,
  workspacePackages: readonly PackageInfo[] = getReleaseInputWorkspacePackages(rootDir),
): string {
  const cacheDir = join(rootDir, "node_modules", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const publishRoot = mkdtempSync(join(cacheDir, "oh-my-pi-publish-"));

  writeRootPublishManifest(rootDir, publishRoot);
  for (const path of [
    "README.md",
    "LICENSE",
    "pnpm-workspace.yaml",
    ".npmrc",
    ".changeset",
    "themes",
  ]) {
    copyIfExists(rootDir, publishRoot, path);
  }
  configurePublishWorkspace(publishRoot);
  for (const pkg of workspacePackages) {
    copyWorkspacePackageForPublish(rootDir, publishRoot, pkg);
  }
  hydrateRootBundledWorkspaceDependencies(rootDir, publishRoot, workspacePackages);

  return publishRoot;
}

function runChangesetsPublish(
  otp: string | undefined,
  workspacePackages: readonly PackageInfo[],
): void {
  const publishRoot = createPublishWorkspace(root, workspacePackages);
  try {
    runChangeset(["publish", ...(otp ? ["--otp", otp] : [])], publishRoot);
  } finally {
    rmSync(publishRoot, { recursive: true, force: true });
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
  runCommand("pnpm", ["run", "build"], root);
  console.log("");

  if (dryRun) {
    runChangeset(["status", "--verbose"], root);
    console.log("\n🏃 Dry run mode. No packages were published and no tags were created.");
    return;
  }

  runChangesetsPublish(otp, releaseInputPackages);
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
