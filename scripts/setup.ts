import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

/** Absolute path to the repository root. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Narrow `unknown` to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to `string[]`. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

interface Category {
  dir: string;
  targetSub: string;
}

const CATEGORIES: Category[] = [
  { dir: "extensions", targetSub: "extensions" },
  { dir: "skills", targetSub: "skills" },
  { dir: "prompts", targetSub: "prompts" },
  { dir: "themes", targetSub: "themes" },
];

interface PlannedOperation {
  src: string;
  dst: string;
  label: string;
  category: string;
}

interface Conflict {
  name: string;
  reason: string;
  /** Where the conflicting item currently lives. */
  location: string;
  /** Where this project is about to install it. */
  target: string;
  uninstallCmd?: string;
}

/** Infer the correct uninstall command from the detected path. */
function inferUninstallCmd(
  name: string,
  location: string,
  globalRoot?: string,
): string | undefined {
  if (globalRoot && location.startsWith(globalRoot)) {
    return `npm uninstall -g ${name}`;
  }
  if (location.includes("/.pi/") || location.includes("\\.pi\\")) {
    return `pi uninstall ${name}`;
  }
  return undefined;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readPkgJson(pkgPath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(pkgPath, "package.json"), "utf8"),
    );
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function getBundledDeps(): Promise<string[]> {
  const pkg = await readPkgJson(REPO_ROOT);
  if (!pkg) return [];
  return isStringArray(pkg.bundledDependencies) ? pkg.bundledDependencies : [];
}

/** Get npm global root directory. */
function getGlobalNpmRoot(): string | undefined {
  try {
    return execSync("npm root -g", { encoding: "utf8", timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Check whether a package is installed globally and is a pi-package. */
async function isGlobalPiPackage(name: string, globalRoot: string): Promise<boolean> {
  const pkgPath = path.join(globalRoot, name);
  const pkg = await readPkgJson(pkgPath);
  if (!pkg) return false;
  try {
    const stat = await fs.stat(pkgPath);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }
  return isRecord(pkg.pi) && Object.keys(pkg.pi).length > 0;
}

/** Check whether a `node_modules` entry resolves back into this monorepo. */
async function isLocalWorkspacePkg(pkgPath: string): Promise<boolean> {
  try {
    const real = await fs.realpath(pkgPath);
    const rel = path.relative(REPO_ROOT, real);
    if (rel.startsWith("..") || rel === "") return false;
    const parts = rel.split(path.sep);
    return parts[0] === "extensions" || parts[0] === "sdk";
  } catch {
    return false;
  }
}

/** Heuristic: does `pkgPath` look like a Pi package? */
async function isPiPackage(pkgPath: string): Promise<boolean> {
  const pkg = await readPkgJson(pkgPath);
  if (!pkg) return false;
  if (pkg.pi) return true;
  for (const cat of CATEGORIES) {
    try {
      const entries = await fs.readdir(path.join(pkgPath, cat.dir));
      if (entries.some((e) => !e.startsWith(".") && e !== "README.md")) {
        return true;
      }
    } catch {
      // skip
    }
  }
  return false;
}

async function packageHasResourceInCategory(
  pkgPath: string,
  category: Category,
  piConfig: Record<string, unknown>,
): Promise<boolean> {
  const hasManifest = Object.keys(piConfig).length > 0;
  if (hasManifest) {
    const sourcesRaw = piConfig[category.targetSub];
    if (isStringArray(sourcesRaw) && sourcesRaw.length > 0) {
      for (const srcRel of sourcesRaw) {
        if (srcRel.startsWith("!")) continue;
        if (srcRel.includes("*")) continue;
        if (!srcRel.startsWith("./")) continue;
        if (await pathExists(path.join(pkgPath, srcRel))) return true;
      }
    }
    return false;
  }
  try {
    const entries = await fs.readdir(path.join(pkgPath, category.dir));
    return entries.some((e) => !e.startsWith(".") && e !== "README.md");
  } catch {
    return false;
  }
}

async function checkConflict(src: string, dst: string): Promise<Conflict | null> {
  if (!(await pathExists(dst))) return null;
  try {
    const realDst = await fs.realpath(dst);
    if (realDst === path.resolve(src)) return null;
  } catch {
    // realpath failed — treat as conflict
  }
  return {
    name: path.basename(dst),
    reason: "already exists in target directory",
    location: dst,
    target: dst,
  };
}

async function collectPlan(
  repoDir: string,
  targetDir: string,
  otherTargetDir: string | undefined,
  checkGlobal: boolean,
): Promise<{ operations: PlannedOperation[]; conflicts: Conflict[] }> {
  const operations: PlannedOperation[] = [];
  const conflicts: Conflict[] = [];
  const globalRoot = checkGlobal ? getGlobalNpmRoot() : undefined;

  // 1. Local categories
  for (const cat of CATEGORIES) {
    const srcDir = path.join(repoDir, cat.dir);
    let entries;
    try {
      entries = await fs.readdir(srcDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    for (const d of dirs) {
      const src = path.join(srcDir, d.name);
      const dst = path.join(targetDir, cat.targetSub, d.name);
      const conflict = await checkConflict(src, dst);
      if (conflict) {
        conflicts.push(conflict);
        operations.push({ src, dst, label: `${d.name}/`, category: cat.dir });
      } else if (!(await pathExists(dst))) {
        operations.push({ src, dst, label: `${d.name}/`, category: cat.dir });
      }
      if (otherTargetDir) {
        const otherDst = path.join(otherTargetDir, cat.targetSub, d.name);
        if (await pathExists(otherDst)) {
          conflicts.push({
            name: d.name,
            reason: `already exists in ${otherTargetDir === path.resolve(REPO_ROOT, ".pi") ? "local" : "global"} scope`,
            location: otherDst,
            target: dst,
            uninstallCmd: inferUninstallCmd(d.name, otherDst),
          });
        }
      }
      if (globalRoot && (await isGlobalPiPackage(d.name, globalRoot))) {
        const location = path.join(globalRoot, d.name);
        conflicts.push({
          name: d.name,
          reason: "already installed globally as pi-package",
          location,
          target: dst,
          uninstallCmd: inferUninstallCmd(d.name, location, globalRoot),
        });
      }
    }

    const files = entries.filter(
      (e) => e.isFile() && !e.name.startsWith(".") && e.name !== "README.md",
    );
    for (const f of files) {
      const src = path.join(srcDir, f.name);
      const dst = path.join(targetDir, cat.targetSub, f.name);
      const conflict = await checkConflict(src, dst);
      if (conflict) {
        conflicts.push(conflict);
        operations.push({ src, dst, label: f.name, category: cat.dir });
      } else if (!(await pathExists(dst))) {
        operations.push({ src, dst, label: f.name, category: cat.dir });
      }
      if (otherTargetDir) {
        const otherDst = path.join(otherTargetDir, cat.targetSub, f.name);
        if (await pathExists(otherDst)) {
          conflicts.push({
            name: f.name,
            reason: `already exists in ${otherTargetDir === path.resolve(REPO_ROOT, ".pi") ? "local" : "global"} scope`,
            location: otherDst,
            target: dst,
            uninstallCmd: inferUninstallCmd(f.name, otherDst),
          });
        }
      }
      if (globalRoot && (await isGlobalPiPackage(f.name, globalRoot))) {
        const location = path.join(globalRoot, f.name);
        conflicts.push({
          name: f.name,
          reason: "already installed globally as pi-package",
          location,
          target: dst,
          uninstallCmd: inferUninstallCmd(f.name, location, globalRoot),
        });
      }
    }
  }

  // 2. Bundled dependencies
  const bundled = await getBundledDeps();

  for (const name of bundled) {
    const pkgPath = path.join(REPO_ROOT, "node_modules", name);

    if (await isLocalWorkspacePkg(pkgPath)) continue;

    if (globalRoot && (await isGlobalPiPackage(name, globalRoot))) {
      const location = path.join(globalRoot, name);
      conflicts.push({
        name,
        reason: "already installed globally as pi-package",
        location,
        target: path.join(targetDir, "extensions", name),
        uninstallCmd: inferUninstallCmd(name, location, globalRoot),
      });
      continue;
    }

    if (!(await isPiPackage(pkgPath))) continue;

    const pkg = await readPkgJson(pkgPath);
    const piConfig = pkg && isRecord(pkg.pi) ? (pkg.pi as Record<string, unknown>) : {};

    for (const cat of CATEGORIES) {
      const hasResource = await packageHasResourceInCategory(pkgPath, cat, piConfig);
      if (!hasResource) continue;
      const dst = path.join(targetDir, cat.targetSub, name);
      const conflict = await checkConflict(pkgPath, dst);
      if (conflict) {
        conflicts.push({ ...conflict, target: dst });
        operations.push({ src: pkgPath, dst, label: `${name}/`, category: "bundled dependencies" });
      } else if (!(await pathExists(dst))) {
        operations.push({ src: pkgPath, dst, label: `${name}/`, category: "bundled dependencies" });
      }
      if (otherTargetDir) {
        const otherDst = path.join(otherTargetDir, cat.targetSub, name);
        if (await pathExists(otherDst)) {
          conflicts.push({
            name,
            reason: `already exists in ${otherTargetDir === path.resolve(REPO_ROOT, ".pi") ? "local" : "global"} scope`,
            location: otherDst,
            target: dst,
            uninstallCmd: inferUninstallCmd(name, otherDst),
          });
        }
      }
    }
  }

  return { operations, conflicts };
}

async function symlinkDir(src: string, dst: string): Promise<void> {
  const absSrc = path.resolve(src);
  const absDst = path.resolve(dst);
  try {
    const stat = await fs.lstat(absDst);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      await fs.rm(absDst, { recursive: true, force: true });
    }
  } catch {
    // dst does not exist
  }
  await fs.mkdir(path.dirname(absDst), { recursive: true });
  if (process.platform === "win32") {
    await fs.symlink(absSrc, absDst, "junction");
  } else {
    await fs.symlink(absSrc, absDst, "dir");
  }
}

async function symlinkFile(src: string, dst: string): Promise<void> {
  const absSrc = path.resolve(src);
  const absDst = path.resolve(dst);
  try {
    const stat = await fs.lstat(absDst);
    if (stat.isSymbolicLink() || stat.isFile()) {
      await fs.rm(absDst, { force: true });
    }
  } catch {
    // dst does not exist
  }
  await fs.mkdir(path.dirname(absDst), { recursive: true });
  await fs.symlink(absSrc, absDst, "file");
}

async function confirm(msg: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(msg, (ans) => resolve(ans.trim()));
    });
    return answer.toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

function parseArgs(argv: string[]): { local: boolean } {
  return { local: argv.includes("--local") || argv.includes("-l") };
}

/**
 * Symlink all project-level resources and bundled dependencies into the Pi
 * agent directory.
 *
 * Before touching anything, the full plan is displayed.  Conflicts are
 * highlighted but not fatal — the user may choose to continue (overwriting
 * existing items) or abort.
 */
async function main(): Promise<void> {
  const { local } = parseArgs(process.argv.slice(2));
  const localTarget = path.resolve(REPO_ROOT, ".pi");
  const globalTarget = path.join(os.homedir(), ".pi", "agent");
  const targetBase = local ? localTarget : globalTarget;
  const otherTarget = local ? globalTarget : localTarget;

  console.log(`Mode: ${local ? "local" : "global"}`);
  console.log(`Target: ${targetBase}\n`);

  const { operations, conflicts } = await collectPlan(REPO_ROOT, targetBase, otherTarget, !local);

  if (operations.length === 0 && conflicts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Show operations
  console.log("The following operations will be performed:\n");
  const grouped = new Map<string, PlannedOperation[]>();
  for (const op of operations) {
    if (!grouped.has(op.category)) grouped.set(op.category, []);
    grouped.get(op.category)!.push(op);
  }

  for (const cat of CATEGORIES) {
    const ops = grouped.get(cat.dir);
    if (!ops || ops.length === 0) continue;
    console.log(`[${cat.dir}]`);
    for (const op of ops) {
      console.log(`  ${op.label} → ${op.dst}`);
    }
  }

  const bundledOps = grouped.get("bundled dependencies");
  if (bundledOps && bundledOps.length > 0) {
    console.log("\n[bundled dependencies]");
    for (const op of bundledOps) {
      console.log(`  ${op.label} → ${op.dst}`);
    }
  }

  // Show conflicts with warning
  if (conflicts.length > 0) {
    console.log("\n⚠️  Conflicts detected:\n");

    for (const c of conflicts) {
      console.log(`  ${c.name}`);
      console.log(`    conflict      : ${c.reason}`);
      console.log(`    location      : ${c.location}`);
      if (c.uninstallCmd) {
        console.log(`    uninstall     : ${c.uninstallCmd}`);
      }
      console.log(`    will install  : ${c.target}`);
    }
    console.log("");
  }

  const ok = await confirm("\nProceed? [y/N] ");
  if (!ok) {
    console.log("Aborted. No changes were made.");
    process.exit(0);
  }

  // Execute
  for (const op of operations) {
    const stat = await fs.stat(op.src);
    if (stat.isDirectory()) {
      await symlinkDir(op.src, op.dst);
    } else {
      await symlinkFile(op.src, op.dst);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
