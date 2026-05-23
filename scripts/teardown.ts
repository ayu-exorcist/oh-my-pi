import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

/** Absolute path to the repository root. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

interface PlannedRemoval {
  path: string;
  label: string;
  category: string;
}

interface SkippedItem {
  name: string;
  reason: string;
}

/** Resolve a path through symlinks, returning `undefined` on failure. */
async function resolveReal(p: string): Promise<string | undefined> {
  try {
    return await fs.realpath(p);
  } catch {
    return undefined;
  }
}

/** Get npm global root directory. */
function getGlobalNpmRoot(): string | undefined {
  try {
    return execSync("npm root -g", { encoding: "utf8", timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Check whether `filePath` is inside `dir`. */
function isInsideDir(dir: string, filePath: string): boolean {
  const rel = path.relative(dir, filePath);
  return !rel.startsWith("..") && rel !== "";
}

/**
 * Scan the target directory and collect everything that teardown intends to
 * remove, plus any items that will be skipped.
 */
async function collectTeardownPlan(
  targetDir: string,
  checkGlobal: boolean,
): Promise<{ removals: PlannedRemoval[]; skipped: SkippedItem[] }> {
  const removals: PlannedRemoval[] = [];
  const skipped: SkippedItem[] = [];
  const globalRoot = checkGlobal ? getGlobalNpmRoot() : undefined;

  for (const cat of CATEGORIES) {
    const dst = path.join(targetDir, cat.targetSub);
    let entries;
    try {
      entries = await fs.readdir(dst, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries.filter((e) => !e.name.startsWith("."))) {
      const dstPath = path.join(dst, e.name);
      const raw = await resolveReal(dstPath);
      if (!raw) continue;

      if (globalRoot && isInsideDir(globalRoot, raw)) {
        skipped.push({
          name: e.name,
          reason: "globally installed pi-package",
        });
        continue;
      }

      const rel = path.relative(REPO_ROOT, raw);
      if (rel.startsWith("..") || rel === "") continue;
      const parts = rel.split(path.sep);
      const isManaged =
        parts[0] === "extensions" ||
        parts[0] === "skills" ||
        parts[0] === "prompts" ||
        parts[0] === "themes" ||
        parts[0] === "node_modules";

      if (!isManaged) continue;

      removals.push({
        path: dstPath,
        label: e.isFile() ? e.name : `${e.name}/`,
        category: cat.dir,
      });
    }
  }

  return { removals, skipped };
}

/** Prompt the user and return `true` only when the answer is exactly "y". */
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
 * Reverse `setup.ts` — remove all symlinks created for this project.
 *
 * Before touching anything, the full plan is displayed.  Skipped items are
 * highlighted but not fatal — the user may choose to continue or abort.
 */
async function main(): Promise<void> {
  const { local } = parseArgs(process.argv.slice(2));
  const targetBase = local
    ? path.resolve(REPO_ROOT, ".pi")
    : path.join(os.homedir(), ".pi", "agent");

  console.log(`Mode: ${local ? "local" : "global"}`);
  console.log(`Target: ${targetBase}\n`);

  const { removals, skipped } = await collectTeardownPlan(targetBase, !local);

  if (removals.length === 0 && skipped.length === 0) {
    console.log("Nothing to remove.");
    return;
  }

  // Show removals
  if (removals.length > 0) {
    console.log("The following items will be removed:\n");
    const grouped = new Map<string, PlannedRemoval[]>();
    for (const r of removals) {
      if (!grouped.has(r.category)) grouped.set(r.category, []);
      grouped.get(r.category)!.push(r);
    }

    for (const cat of CATEGORIES) {
      const items = grouped.get(cat.dir);
      if (!items || items.length === 0) continue;
      console.log(`[${cat.dir}]`);
      for (const item of items) {
        console.log(`  remove ${item.label}`);
      }
    }
  }

  // Show skipped items
  if (skipped.length > 0) {
    console.log("\nThe following items are skipped (not managed by this project):\n");
    for (const s of skipped) {
      console.log(`  ${s.name}  (${s.reason})`);
    }
    console.log("");
  }

  const ok = await confirm("\nProceed? [y/N] ");
  if (!ok) {
    console.log("Aborted. No changes were made.");
    process.exit(0);
  }

  // Execute
  for (const r of removals) {
    try {
      const stat = await fs.lstat(r.path);
      if (stat.isSymbolicLink() || stat.isDirectory() || stat.isFile()) {
        await fs.rm(r.path, { recursive: true, force: true });
      }
    } catch {
      // ignore errors for individual items
    }
  }

  for (const cat of CATEGORIES) {
    const dst = path.join(targetBase, cat.targetSub);
    try {
      const remaining = await fs.readdir(dst);
      if (remaining.length === 0) {
        await fs.rmdir(dst);
      }
    } catch {
      // ignore
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
