import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getGitDir, resolveWorktreeCheckpointStoragePaths } from "./resolver";
import { RepoManager } from "./repo-manager";
import * as lock from "./lock";
import {
  cloneSessionCheckpointStorage,
  ensureSessionCheckpointStorage,
  resolveSessionCheckpointStorage,
  safeCloneSessionCheckpointStorage,
  safeEnsureSessionCheckpointStorage,
} from "./session-checkpoint-storage";

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-checkpoint-storage-test-"));
}

describe("Session Checkpoint Storage", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("reports missing Worktree Checkpoint Storage without creating repo.git", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "missing.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);

    const result = await resolveSessionCheckpointStorage({ sessionFile, cwd: tmpDir });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    await expect(fs.access(paths.gitDir)).rejects.toBeDefined();
  });

  test("creates missing Worktree Checkpoint Storage for a Producer", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "created.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await ensureSessionCheckpointStorage({
      sessionFile,
      cwd: tmpDir,
      exclude: ["node_modules/"],
    });

    expect(result.repoDir).toBe(paths.repoDir);
    expect(result.gitDir).toBe(paths.gitDir);
    expect(result.indexFile).toBe(paths.indexFile);
    expect(result.worktreeId).toBe(paths.worktreeId);
    expect(init).toHaveBeenCalled();
    expect(setExclude).toHaveBeenCalledWith(["node_modules/"]);
  });

  test("resolves existing Worktree Checkpoint Storage", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "existing.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    await fs.mkdir(paths.gitDir, { recursive: true });

    const result = await resolveSessionCheckpointStorage({ sessionFile, cwd: tmpDir });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repoDir).toBe(paths.repoDir);
      expect(result.gitDir).toBe(paths.gitDir);
      expect(result.indexFile).toBe(paths.indexFile);
    }
  });

  test("forks in the same worktree reuse existing Worktree Checkpoint Storage", async () => {
    const sourceSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl");
    const forkSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    await fs.mkdir(paths.gitDir, { recursive: true });
    const cloneFrom = vi.spyOn(RepoManager, "cloneFrom").mockResolvedValue(undefined);

    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: sourceSessionFile,
      sessionFile: forkSessionFile,
      cwd: tmpDir,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, repoDir: paths.repoDir }));
    expect(cloneFrom).not.toHaveBeenCalled();
  });

  test("fork reuse refreshes exclude when provided", async () => {
    const sourceSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl");
    const forkSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    await fs.mkdir(paths.gitDir, { recursive: true });
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: sourceSessionFile,
      sessionFile: forkSessionFile,
      cwd: tmpDir,
      exclude: ["node_modules/"],
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, repoDir: paths.repoDir }));
    expect(setExclude).toHaveBeenCalledWith(["node_modules/"]);
  });

  test("missing fork source initializes shared Worktree Checkpoint Storage", async () => {
    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "missing-source.jsonl"),
      sessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl"),
      cwd: tmpDir,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
  });

  test("missing fork source initializes shared storage and writes exclude", async () => {
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "missing-source.jsonl"),
      sessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl"),
      cwd: tmpDir,
      exclude: ["node_modules/"],
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(setExclude).toHaveBeenCalledWith(["node_modules/"]);
  });

  test("safeEnsureSessionCheckpointStorage serialises storage bootstrap", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "safe-created.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    const withRepoLock = vi
      .spyOn(lock, "withRepoLock")
      .mockImplementation(async (_repoDir, fn) => fn());
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await safeEnsureSessionCheckpointStorage({
      sessionFile,
      cwd: tmpDir,
      exclude: ["node_modules/"],
    });

    expect(withRepoLock).toHaveBeenCalled();
    expect(result.repoDir).toBe(paths.repoDir);
    expect(init).toHaveBeenCalled();
    expect(setExclude).toHaveBeenCalledWith(["node_modules/"]);
  });

  test("safeEnsureSessionCheckpointStorage reuses existing storage", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "safe-existing.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    await fs.mkdir(paths.gitDir, { recursive: true });
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);

    const result = await safeEnsureSessionCheckpointStorage({
      sessionFile,
      cwd: tmpDir,
      exclude: [],
    });

    expect(result.repoDir).toBe(paths.repoDir);
    expect(init).not.toHaveBeenCalled();
  });

  test("safeCloneSessionCheckpointStorage serialises clone bootstrap", async () => {
    const sourceSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "safe-source.jsonl");
    const forkSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "safe-fork.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);

    const withRepoLock = vi
      .spyOn(lock, "withRepoLock")
      .mockImplementation(async (_repoDir, fn) => fn());
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);

    const result = await safeCloneSessionCheckpointStorage({
      previousSessionFile: sourceSessionFile,
      sessionFile: forkSessionFile,
      cwd: tmpDir,
    });

    expect(withRepoLock).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ ok: true, repoDir: paths.repoDir }));
    expect(init).toHaveBeenCalled();
  });

  test("safe clone reuse skips exclude refresh when none provided", async () => {
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    await fs.mkdir(paths.gitDir, { recursive: true });
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await safeCloneSessionCheckpointStorage({
      previousSessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl"),
      sessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl"),
      cwd: tmpDir,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(setExclude).not.toHaveBeenCalled();
  });

  test("safe clone writes exclude when creating shared storage", async () => {
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    await safeCloneSessionCheckpointStorage({
      previousSessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl"),
      sessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl"),
      cwd: tmpDir,
      exclude: ["node_modules/"],
    });

    expect(setExclude).toHaveBeenCalledWith(["node_modules/"]);
  });

  test("safeCloneSessionCheckpointStorage writes exclude before checkout", async () => {
    const sourceSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl");
    const forkSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl");
    const workTree = path.join(tmpDir, "project");
    const excludedFile = path.join(workTree, "node_modules", "pkg", "index.js");
    await fs.mkdir(path.dirname(excludedFile), { recursive: true });

    const source = await ensureSessionCheckpointStorage({
      sessionFile: sourceSessionFile,
      cwd: workTree,
      exclude: ["node_modules/", "**/node_modules/"],
    });
    await fs.writeFile(path.join(workTree, "root.txt"), "tracked", "utf8");
    await fs.writeFile(excludedFile, "ignored", "utf8");
    const hash = await source.repo.checkpoint("entry-1");

    const result = await safeCloneSessionCheckpointStorage({
      previousSessionFile: sourceSessionFile,
      sessionFile: forkSessionFile,
      cwd: workTree,
      exclude: ["node_modules/", "**/node_modules/"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    await result.repo.checkoutCommit(hash);

    await expect(fs.access(excludedFile)).resolves.toBeUndefined();
  });

  test("Producer reuses existing Worktree Checkpoint Storage and refreshes exclude", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "existing-producer.jsonl");
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    await fs.mkdir(paths.gitDir, { recursive: true });
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await ensureSessionCheckpointStorage({
      sessionFile,
      cwd: tmpDir,
      exclude: ["node_modules/"],
    });

    expect(result.repoDir).toBe(paths.repoDir);
    expect(init).not.toHaveBeenCalled();
    expect(setExclude).toHaveBeenCalledWith(["node_modules/"]);
  });

  test("new internal git repo name is repo.git", async () => {
    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    expect(getGitDir(paths.repoDir)).toBe(path.join(paths.repoDir, "repo.git"));
  });
});
