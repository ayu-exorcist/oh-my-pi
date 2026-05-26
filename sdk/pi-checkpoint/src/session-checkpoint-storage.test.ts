import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getGitDir, getRepoDir } from "./resolver";
import { RepoManager } from "./repo-manager";
import {
  cloneSessionCheckpointStorage,
  ensureSessionCheckpointStorage,
  resolveSessionCheckpointStorage,
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

  test("reports missing Checkpoint Storage without creating it", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "missing.jsonl");

    const result = await resolveSessionCheckpointStorage({ sessionFile, cwd: tmpDir });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    await expect(fs.access(getGitDir(getRepoDir(sessionFile)))).rejects.toBeDefined();
  });

  test("creates missing Checkpoint Storage for a Producer", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "created.jsonl");
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await ensureSessionCheckpointStorage({
      sessionFile,
      cwd: tmpDir,
      exclude: ["node_modules/**"],
    });

    expect(result.repoDir).toBe(getRepoDir(sessionFile));
    expect(result.gitDir).toBe(getGitDir(getRepoDir(sessionFile)));
    expect(init).toHaveBeenCalled();
    expect(setExclude).toHaveBeenCalledWith(["node_modules/**"]);
  });

  test("resolves existing Checkpoint Storage", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "existing.jsonl");
    const repoDir = getRepoDir(sessionFile);
    await fs.mkdir(getGitDir(repoDir), { recursive: true });

    const result = await resolveSessionCheckpointStorage({ sessionFile, cwd: tmpDir });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repoDir).toBe(repoDir);
      expect(result.gitDir).toBe(getGitDir(repoDir));
      expect(result.indexFile).toBe(path.join(repoDir, "index"));
    }
  });

  test("clones Checkpoint Storage for a fork", async () => {
    const sourceSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl");
    const forkSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl");
    const sourceRepoDir = getRepoDir(sourceSessionFile);
    await fs.mkdir(getGitDir(sourceRepoDir), { recursive: true });
    const cloneFrom = vi.spyOn(RepoManager, "cloneFrom").mockResolvedValue(undefined);

    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: sourceSessionFile,
      sessionFile: forkSessionFile,
      cwd: tmpDir,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: true, repoDir: getRepoDir(forkSessionFile) }),
    );
    expect(cloneFrom).toHaveBeenCalledWith(
      getGitDir(sourceRepoDir),
      getGitDir(getRepoDir(forkSessionFile)),
    );
  });

  test("reports missing source Checkpoint Storage for a fork", async () => {
    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "missing-source.jsonl"),
      sessionFile: path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl"),
      cwd: tmpDir,
    });

    expect(result).toEqual({ ok: false, reason: "source-not-found" });
  });

  test("reports existing destination Checkpoint Storage for a fork", async () => {
    const sourceSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "source.jsonl");
    const forkSessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "fork.jsonl");
    await fs.mkdir(getGitDir(getRepoDir(sourceSessionFile)), { recursive: true });
    await fs.mkdir(getGitDir(getRepoDir(forkSessionFile)), { recursive: true });

    const result = await cloneSessionCheckpointStorage({
      previousSessionFile: sourceSessionFile,
      sessionFile: forkSessionFile,
      cwd: tmpDir,
    });

    expect(result).toEqual({ ok: false, reason: "destination-exists" });
  });

  test("Producer reuses existing Checkpoint Storage", async () => {
    const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "existing-producer.jsonl");
    const repoDir = getRepoDir(sessionFile);
    await fs.mkdir(getGitDir(repoDir), { recursive: true });
    const init = vi.spyOn(RepoManager.prototype, "init").mockResolvedValue(undefined);
    const setExclude = vi.spyOn(RepoManager.prototype, "setExclude").mockResolvedValue(undefined);

    const result = await ensureSessionCheckpointStorage({
      sessionFile,
      cwd: tmpDir,
      exclude: ["node_modules/**"],
    });

    expect(result.repoDir).toBe(repoDir);
    expect(init).not.toHaveBeenCalled();
    expect(setExclude).not.toHaveBeenCalled();
  });
});
