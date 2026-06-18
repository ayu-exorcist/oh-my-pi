import type { Dirent } from "node:fs";
import path from "node:path";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { exec, type ExecEnv } from "./exec";
import { withRepoLock } from "./lock";

const AUTO_EXCLUDE_SCAN_ALWAYS_PRUNE_DIRS = new Set([".git", ".pi"]);
const AUTO_EXCLUDE_SCAN_CONFIGURED_PRUNE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
]);

function getDirectoryExcludePatterns(dirName: string): Set<string> {
  return new Set([
    dirName,
    `${dirName}/`,
    `${dirName}/**`,
    `**/${dirName}`,
    `**/${dirName}/`,
    `**/${dirName}/**`,
  ]);
}

function hasDirectoryExclude(patterns: readonly string[], dirName: string): boolean {
  const directoryExcludePatterns = getDirectoryExcludePatterns(dirName);
  return patterns.some((pattern) => directoryExcludePatterns.has(pattern));
}

function shouldPruneAutoExcludeScanDir(dirName: string, patterns: readonly string[]): boolean {
  if (AUTO_EXCLUDE_SCAN_ALWAYS_PRUNE_DIRS.has(dirName)) return true;
  return (
    AUTO_EXCLUDE_SCAN_CONFIGURED_PRUNE_DIRS.has(dirName) && hasDirectoryExclude(patterns, dirName)
  );
}

function toGitPath(workTree: string, absolutePath: string): string {
  return path.relative(workTree, absolutePath).replace(/[\\/]+/g, "/");
}

/**
 * Outcome of {@link RepoManager.safeCheckout}.
 *
 * Discriminated union so callers handle every path at the type level.
 */
export type SafeCheckoutResult =
  | { readonly ok: true; readonly safetyHash?: string }
  | { readonly ok: false; readonly reason: "dirty" }
  | {
      readonly ok: false;
      readonly reason: "checkout-failed";
      readonly error: string;
      readonly rollbackError?: string;
    };

/**
 * Manages a git bare repository used for file-level checkpoints.
 *
 * Each session gets its own bare repo under `~/.pi/agent/ayu/checkpoints/sessions/`.
 * The work tree points to the user's project directory so that `git add/checkout`
 * operate directly on the project files.
 */
export class RepoManager {
  private env: ExecEnv;

  private repoDir: string;

  private excludePatterns: readonly string[] | undefined;

  constructor(
    /** Absolute path to the bare `.git` directory. */
    private gitDir: string,
    /** Absolute path to the git index file (outside the work tree). */
    indexFile: string,
    /** Absolute path to the project working directory. */
    private workTree: string,
  ) {
    this.repoDir = path.dirname(gitDir);
    this.env = {
      GIT_DIR: gitDir,
      GIT_WORK_TREE: workTree,
      GIT_INDEX_FILE: indexFile,
    };
  }

  /**
   * Execute `fn` while holding an exclusive filesystem lock on this repo.
   *
   * Serialises concurrent access across processes and separate package installs.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    return withRepoLock(this.repoDir, fn);
  }

  private gitArgs(): string[] {
    return [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.safecrlf=false",
      "-c",
      "core.filemode=false",
      "-c",
      "core.quotepath=false",
      `--git-dir=${this.gitDir}`,
      `--work-tree=${this.workTree}`,
    ];
  }

  private static async configureIdentity(gitDir: string): Promise<void> {
    await exec("git", [`--git-dir=${gitDir}`, "config", "user.email", "pi@checkpoint.local"]);
    await exec("git", [`--git-dir=${gitDir}`, "config", "user.name", "Pi Checkpoint"]);
  }

  /** Initialize a fresh bare repo and set default git config. */
  async init(): Promise<void> {
    await mkdir(path.dirname(this.gitDir), { recursive: true });
    await exec("git", ["init", "--bare", this.gitDir]);
    await RepoManager.configureIdentity(this.gitDir);
  }

  /** Initialize the bare repo while holding the repo lock. */
  async lockedInit(): Promise<void> {
    await this.withLock(async () => {
      await this.init();
    });
  }

  /**
   * Silently re-initialise the bare repo if it has been deleted externally.
   *
   * Used before operations that assume the repo exists (e.g. checkpoint).
   * Does nothing when the repo is still intact.
   */
  async ensureReady(excludePatterns?: readonly string[]): Promise<void> {
    try {
      await exec("git", [...this.gitArgs(), "rev-parse", "--git-dir"], this.env, this.workTree);
    } catch {
      await this.init();
    }

    if (excludePatterns) {
      await this.setExclude(excludePatterns);
    }
  }

  /** Ensure the bare repo exists while holding the repo lock. */
  async lockedEnsureReady(excludePatterns?: readonly string[]): Promise<void> {
    await this.withLock(async () => {
      await this.ensureReady(excludePatterns);
    });
  }

  private async findNestedGitRepoExcludes(patterns: readonly string[]): Promise<string[]> {
    const workTree = path.resolve(this.workTree);
    const roots: string[] = [];
    const stack = [workTree];

    while (true) {
      const current = stack.pop();
      if (current === undefined) break;

      let entries: Dirent[];
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      const hasGitMarker = entries.some(
        (entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()),
      );
      if (current !== workTree && hasGitMarker) {
        const relative = toGitPath(workTree, current);
        roots.push(`${relative}/`);
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (shouldPruneAutoExcludeScanDir(entry.name, patterns)) continue;
        stack.push(path.join(current, entry.name));
      }
    }

    return roots.sort();
  }

  private async writeExclude(patterns: readonly string[]): Promise<void> {
    const excludePath = path.join(this.gitDir, "info", "exclude");
    const autoExcludes = await this.findNestedGitRepoExcludes(patterns);
    const allPatterns = [...new Set([...patterns, ...autoExcludes])];
    await mkdir(path.dirname(excludePath), { recursive: true });
    await writeFile(excludePath, allPatterns.join("\n") + "\n", "utf8");
  }

  private async refreshExclude(): Promise<void> {
    if (!this.excludePatterns) return;
    await this.writeExclude(this.excludePatterns);
  }

  /** Write exclude patterns to `info/exclude` inside the bare repo. */
  async setExclude(patterns: readonly string[]): Promise<void> {
    const explicitPatterns = [...patterns];
    this.excludePatterns = explicitPatterns;
    await this.writeExclude(explicitPatterns);
  }

  /** Write exclude patterns while holding the repo lock. */
  async lockedSetExclude(patterns: readonly string[]): Promise<void> {
    await this.withLock(async () => {
      await this.setExclude(patterns);
    });
  }

  /**
   * Stage all files and create a checkpoint commit.
   *
   * @param entryId - Session entry id to embed in the commit message.
   * @returns The 40-character commit hash.
   */
  async checkpoint(entryId: string): Promise<string> {
    await this.stageAll();
    await exec(
      "git",
      [...this.gitArgs(), "commit", "-m", `[pi] entry:${entryId}`, "--allow-empty"],
      this.env,
      this.workTree,
    );
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "rev-parse", "HEAD"],
      this.env,
      this.workTree,
    );
    return stdout.trim();
  }

  /** Create a checkpoint while holding the repo lock. */
  async lockedCheckpoint(entryId: string): Promise<string> {
    return this.withLock(async () => this.checkpoint(entryId));
  }

  /** Hard-reset the work tree to `commitHash` and remove untracked files. */
  async checkoutCommit(commitHash: string): Promise<void> {
    await exec("git", [...this.gitArgs(), "reset", "--hard", commitHash], this.env, this.workTree);
    await exec("git", [...this.gitArgs(), "clean", "-fd"], this.env, this.workTree);
  }

  /** Check out a commit while holding the repo lock. */
  async lockedCheckoutCommit(commitHash: string): Promise<void> {
    await this.withLock(async () => {
      await this.checkoutCommit(commitHash);
    });
  }

  /**
   * Create a temporary safety commit capturing the current work tree state.
   *
   * Used before destructive operations so we can roll back on failure.
   * @returns The safety commit hash.
   */
  async createSafetyCommit(): Promise<string> {
    await this.stageAll();
    await exec("git", [...this.gitArgs(), "commit", "-m", "[pi] safety"], this.env, this.workTree);
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "rev-parse", "HEAD"],
      this.env,
      this.workTree,
    );
    return stdout.trim();
  }

  /** Create a safety commit while holding the repo lock. */
  async lockedCreateSafetyCommit(): Promise<string> {
    return this.withLock(async () => this.createSafetyCommit());
  }

  /** Clone a bare repo (used when forking/cloning a session). */
  static async cloneFrom(srcGitDir: string, dstGitDir: string): Promise<void> {
    await exec("git", ["clone", "--local", "--bare", srcGitDir, dstGitDir]);
    await RepoManager.configureIdentity(dstGitDir);
  }

  /** Update a git ref to point at `commitHash`. */
  async updateRef(ref: string, commitHash: string): Promise<void> {
    await exec("git", [...this.gitArgs(), "update-ref", ref, commitHash], this.env, this.workTree);
  }

  /** Update a git ref while holding the repo lock. */
  async lockedUpdateRef(ref: string, commitHash: string): Promise<void> {
    await this.withLock(async () => {
      await this.updateRef(ref, commitHash);
    });
  }

  /**
   * Return `--numstat` diff between the commit's parent and the commit itself.
   *
   * Falls back to `git show --numstat` for the first commit (no parent).
   */
  async diffStats(commitHash: string): Promise<string> {
    try {
      const { stdout } = await exec(
        "git",
        [...this.gitArgs(), "diff", "--numstat", `${commitHash}~1`, commitHash],
        this.env,
        this.workTree,
      );
      return stdout;
    } catch {
      const { stdout } = await exec(
        "git",
        [...this.gitArgs(), "show", "--numstat", "--format=", commitHash],
        this.env,
        this.workTree,
      );
      return stdout;
    }
  }

  /** Return `--numstat` diff between `commitHash` and the current working tree. */
  async diffWorkingTree(commitHash: string): Promise<string> {
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "diff", "--numstat", commitHash],
      this.env,
      this.workTree,
    );
    return stdout;
  }

  private async removeIgnoredFromIndex(): Promise<void> {
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "ls-files", "-z", "-i", "-c", "--exclude-standard"],
      this.env,
      this.workTree,
    );
    const paths = stdout.split("\0").filter((entry) => entry.length > 0);
    if (paths.length === 0) return;

    const chunkSize = 100;
    for (let index = 0; index < paths.length; index += chunkSize) {
      const chunk = paths.slice(index, index + chunkSize);
      await exec(
        "git",
        [...this.gitArgs(), "rm", "--cached", "-r", "--ignore-unmatch", "--", ...chunk],
        this.env,
        this.workTree,
      );
    }
  }

  /** Stage all changes in the working tree. */
  async stageAll(): Promise<void> {
    await this.refreshExclude();
    await this.removeIgnoredFromIndex();
    await exec("git", [...this.gitArgs(), "add", "-A"], this.env, this.workTree);
  }

  /** Stage all changes while holding the repo lock. */
  async lockedStageAll(): Promise<void> {
    await this.withLock(async () => {
      await this.stageAll();
    });
  }

  /** Return `--numstat` diff between the staged index and `commitHash`. */
  async diffAgainst(commitHash: string): Promise<string> {
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "diff", "--numstat", "--cached", commitHash],
      this.env,
      this.workTree,
    );
    return stdout;
  }

  /**
   * Safely check out `targetCommit` with dirty-guard, safety-commit, and
   * automatic rollback on failure.
   *
   * The entire sequence runs inside {@link withLock} so concurrent callers
   * are serialised.
   *
   * @param targetCommit - The commit hash to check out.
   * @param dirtyBaseCommit - If provided, compare the working tree against
   *   this commit to detect unsnapshotted changes. When dirty, returns
   *   `{ ok: false, reason: "dirty" }`.
   */
  async safeCheckout(targetCommit: string, dirtyBaseCommit?: string): Promise<SafeCheckoutResult> {
    return this.withLock(async () => {
      // 1. Dirty guard
      if (dirtyBaseCommit) {
        try {
          await this.stageAll();
          const dirtyStdout = await this.diffAgainst(dirtyBaseCommit);
          if (dirtyStdout.trim().length > 0) {
            return { ok: false, reason: "dirty" };
          }
        } catch {
          // Skip dirty check if diff fails
        }
      }

      // 2. Safety commit
      let safetyHash: string | undefined;
      try {
        safetyHash = await this.createSafetyCommit();
      } catch {
        // Proceed without safety commit
      }

      // 3. Checkout
      try {
        await this.checkoutCommit(targetCommit);
        return safetyHash ? { ok: true, safetyHash } : { ok: true };
      } catch (err) {
        // 4. Rollback on failure
        if (safetyHash) {
          try {
            await this.checkoutCommit(safetyHash);
          } catch (rollbackErr) {
            return {
              ok: false,
              reason: "checkout-failed",
              error: err instanceof Error ? err.message : String(err),
              rollbackError:
                rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
            };
          }
        }
        return {
          ok: false,
          reason: "checkout-failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }
}
