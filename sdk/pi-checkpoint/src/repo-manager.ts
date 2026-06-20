import type { Dirent } from "node:fs";
import path from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { exec, type ExecEnv } from "./exec";
import { withRepoLock } from "./lock";

const AUTO_EXCLUDE_SCAN_ALWAYS_PRUNE_DIRS = new Set([".git", ".pi"]);
const AUTO_EXCLUDE_SCAN_CONFIGURED_PRUNE_DIRS = new Set([
  "node_modules",
  ".gradle",
  ".ark",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".angular",
  ".vite",
  ".parcel-cache",
  ".turbo",
  "dist",
  "build",
  "target",
  "coverage",
  ".cache",
  ".venv",
  "venv",
  ".tox",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "htmlcov",
  "Pods",
  ".expo",
  ".cxx",
  ".externalNativeBuild",
  ".build",
  "DerivedData",
  ".terraform",
  ".serverless",
  ".aws-sam",
  ".idea",
  ".vscode",
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
  | { readonly ok: false; readonly reason: "dirty-check-failed"; readonly error: string }
  | {
      readonly ok: false;
      readonly reason: "checkout-failed";
      readonly error: string;
      readonly rollbackError?: string;
    };

/**
 * Manages a git bare repository used for file-level checkpoints.
 *
 * The repo is stored in Worktree Checkpoint Storage under
 * `~/.pi/agent/ayu/checkpoints/worktrees/<worktree-id>/repo.git`.
 * The work tree points to the user's project directory so that `git add/checkout`
 * operate directly on the project files.
 */
export class RepoManager {
  private env: ExecEnv;

  private repoDir: string;

  private excludePatterns: readonly string[] | undefined;

  private maxFileBytes: number | undefined;

  private skippedLargeFiles: readonly string[] = [];

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

  private async findLargeFileExcludes(patterns: readonly string[]): Promise<string[]> {
    if (this.maxFileBytes === undefined) return [];

    const workTree = path.resolve(this.workTree);
    const largeFiles: string[] = [];
    const stack = [workTree];

    while (true) {
      const current = stack.pop();
      if (current === undefined) break;

      let entries: Dirent[];
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        /* c8 ignore next -- defensive against directories disappearing during large-file scan. */
        continue;
      }

      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          /* c8 ignore next -- Node Dirent symlinks are not reported as directories on supported platforms. */
          if (entry.isSymbolicLink()) continue;
          if (shouldPruneAutoExcludeScanDir(entry.name, patterns)) continue;
          stack.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const info = await stat(absolutePath);
          if (info.size > this.maxFileBytes) largeFiles.push(toGitPath(workTree, absolutePath));
        } catch {
          /* c8 ignore next -- defensive against files disappearing during large-file scan. */
          continue;
        }
      }
    }

    return largeFiles.sort();
  }

  /** Return files skipped by the most recent large-file scan. */
  getSkippedLargeFiles(): readonly string[] {
    return this.skippedLargeFiles;
  }

  private async writeExclude(patterns: readonly string[]): Promise<void> {
    const excludePath = path.join(this.gitDir, "info", "exclude");
    const autoExcludes = await this.findNestedGitRepoExcludes(patterns);
    const largeFileExcludes = await this.findLargeFileExcludes(patterns);
    this.skippedLargeFiles = largeFileExcludes;
    const allPatterns = [...new Set([...patterns, ...autoExcludes, ...largeFileExcludes])];
    await mkdir(path.dirname(excludePath), { recursive: true });
    await writeFile(excludePath, allPatterns.join("\n") + "\n", "utf8");
  }

  private async refreshExclude(): Promise<void> {
    await this.writeExclude(this.excludePatterns ?? []);
  }

  /** Set the maximum file size captured by future checkpoints. */
  setLargeFileLimit(maxFileBytes: number | undefined): void {
    this.maxFileBytes = maxFileBytes;
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

  private async getHeadCommit(): Promise<string | undefined> {
    try {
      const { stdout } = await exec(
        "git",
        [...this.gitArgs(), "rev-parse", "--verify", "HEAD"],
        this.env,
        this.workTree,
      );
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async updateHead(commitHash: string): Promise<void> {
    await exec(
      "git",
      [...this.gitArgs(), "update-ref", "HEAD", commitHash],
      this.env,
      this.workTree,
    );
  }

  private async createRootCommitFromIndex(
    subject: string,
    previousCommit: string | undefined,
  ): Promise<string> {
    const { stdout: treeStdout } = await exec(
      "git",
      [...this.gitArgs(), "write-tree"],
      this.env,
      this.workTree,
    );
    const treeHash = treeStdout.trim();
    const { stdout } = await exec(
      "git",
      [
        ...this.gitArgs(),
        "commit-tree",
        treeHash,
        "-m",
        subject,
        ...(previousCommit ? ["-m", `pi-checkpoint-previous: ${previousCommit}`] : []),
      ],
      this.env,
      this.workTree,
    );
    const commitHash = stdout.trim();
    /* c8 ignore next -- git commit-tree either returns a hash or rejects; empty stdout is a defensive guard. */
    if (!commitHash) throw new Error("Checkpoint commit did not create a commit hash");
    await this.updateHead(commitHash);
    return commitHash;
  }

  /**
   * Stage all files and create a checkpoint commit.
   *
   * Equal staged states reuse the current HEAD commit instead of creating an
   * empty commit. New states are stored as parentless commits so only explicit
   * checkpoint refs protect historical states; deleting those refs lets git GC
   * reclaim expired file-restore objects.
   *
   * @param entryId - Session entry id to embed in the commit message.
   * @returns The 40-character commit hash.
   */
  async checkpoint(entryId: string): Promise<string> {
    await this.stageAll();
    const headCommit = await this.getHeadCommit();
    if (headCommit) {
      const diff = await this.diffAgainst(headCommit);
      if (diff.trim().length === 0) return headCommit;
    }

    return this.createRootCommitFromIndex(`[pi] entry:${entryId}`, headCommit);
  }

  /** Create a checkpoint while holding the repo lock. */
  async lockedCheckpoint(entryId: string): Promise<string> {
    return this.withLock(async () => this.checkpoint(entryId));
  }

  private resolveGitPath(gitPath: string): string | undefined {
    const absolutePath = path.resolve(this.workTree, gitPath);
    const relative = path.relative(this.workTree, absolutePath);
    /* c8 ignore next -- git tree paths come from git and are scoped under workTree. */
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return absolutePath;
  }

  private async isIgnoredPath(gitPath: string): Promise<boolean> {
    try {
      await exec(
        "git",
        [...this.gitArgs(), "check-ignore", "-q", "--", gitPath],
        this.env,
        this.workTree,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async listIgnoredTargetFiles(commitHash: string): Promise<readonly string[]> {
    await this.refreshExclude();
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "ls-tree", "-r", "--name-only", "-z", commitHash],
      this.env,
      this.workTree,
    );
    const paths = stdout.split("\0").filter((entry) => entry.length > 0);
    const ignoredPaths: string[] = [];
    for (const gitPath of paths) {
      if (await this.isIgnoredPath(gitPath)) ignoredPaths.push(gitPath);
    }
    return ignoredPaths.sort();
  }

  private async captureIgnoredTargetFiles(commitHash: string): Promise<
    readonly {
      readonly gitPath: string;
      readonly content: Buffer | undefined;
    }[]
  > {
    const ignoredPaths = await this.listIgnoredTargetFiles(commitHash);
    const backups: Array<{ readonly gitPath: string; readonly content: Buffer | undefined }> = [];
    for (const gitPath of ignoredPaths) {
      const absolutePath = this.resolveGitPath(gitPath);
      /* c8 ignore next -- git tree paths come from git and are scoped under workTree. */
      if (!absolutePath) continue;
      try {
        backups.push({ gitPath, content: await readFile(absolutePath) });
      } catch {
        /* c8 ignore next -- defensive against ignored files disappearing between backup scan and read. */
        backups.push({ gitPath, content: undefined });
      }
    }
    return backups;
  }

  private async restoreIgnoredTargetFiles(
    backups: readonly { readonly gitPath: string; readonly content: Buffer | undefined }[],
  ): Promise<void> {
    for (const backup of backups) {
      const absolutePath = this.resolveGitPath(backup.gitPath);
      /* c8 ignore next -- git tree paths come from git and are scoped under workTree. */
      if (!absolutePath) continue;
      if (backup.content === undefined) {
        await rm(absolutePath, { force: true, recursive: true });
        continue;
      }
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, backup.content);
    }
  }

  /** Hard-reset the work tree to `commitHash` and remove untracked files. */
  async checkoutCommit(commitHash: string): Promise<void> {
    const ignoredBackups = await this.captureIgnoredTargetFiles(commitHash);
    await exec("git", [...this.gitArgs(), "reset", "--hard", commitHash], this.env, this.workTree);
    await exec("git", [...this.gitArgs(), "clean", "-fd"], this.env, this.workTree);
    await this.restoreIgnoredTargetFiles(ignoredBackups);
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
    return this.createRootCommitFromIndex("[pi] safety", await this.getHeadCommit());
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
    const previousCommit = await this.getPreviousCheckpointCommit(commitHash);
    if (previousCommit) {
      const { stdout } = await exec(
        "git",
        [...this.gitArgs(), "diff", "--numstat", previousCommit, commitHash],
        this.env,
        this.workTree,
      );
      return stdout;
    }

    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "show", "--numstat", "--format=", commitHash],
      this.env,
      this.workTree,
    );
    return stdout;
  }

  private async getPreviousCheckpointCommit(commitHash: string): Promise<string | undefined> {
    try {
      const { stdout } = await exec(
        "git",
        [...this.gitArgs(), "show", "-s", "--format=%B", commitHash],
        this.env,
        this.workTree,
      );
      const match = /^pi-checkpoint-previous: ([a-f0-9]{40})$/mu.exec(stdout);
      return match?.[1];
    } catch {
      /* c8 ignore next -- defensive fallback when commit-message lookup fails; first-commit diffStats fallback is covered. */
      return undefined;
    }
  }

  /** Return whether a checkpoint state commit exists in storage. */
  async hasCommit(commitHash: string): Promise<boolean> {
    try {
      await exec(
        "git",
        [...this.gitArgs(), "cat-file", "-e", `${commitHash}^{commit}`],
        this.env,
        this.workTree,
      );
      return true;
    } catch {
      return false;
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

  /** Return changed paths between the staged index and `commitHash` that are currently managed. */
  private async managedDiffPathsAgainst(commitHash: string): Promise<readonly string[]> {
    const { stdout } = await exec(
      "git",
      [...this.gitArgs(), "diff", "--cached", "--name-only", "-z", commitHash],
      this.env,
      this.workTree,
    );
    const paths = stdout.split("\0").filter((entry) => entry.length > 0);
    const managedPaths: string[] = [];
    for (const gitPath of paths) {
      if (!(await this.isIgnoredPath(gitPath))) managedPaths.push(gitPath);
    }
    return managedPaths;
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
            const dirtyPaths = await this.managedDiffPathsAgainst(dirtyBaseCommit);
            if (dirtyPaths.length > 0) {
              return { ok: false, reason: "dirty" };
            }
          }
        } catch (err) {
          return {
            ok: false,
            reason: "dirty-check-failed",
            error: err instanceof Error ? err.message : String(err),
          };
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
