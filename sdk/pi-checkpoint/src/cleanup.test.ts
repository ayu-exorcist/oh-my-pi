import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cleanupCheckpointStorage,
  cleanupLegacySessionCheckpointStorage,
  cleanupTemporaryCheckpointArtifacts,
} from "./cleanup";
import { getCheckpointRootDir, getLegacySessionsDir } from "./resolver";
import { withRepoLock } from "./lock";
import { RepoManager } from "./repo-manager";
import { exec } from "./exec";

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "checkpoint-cleanup-test-"));
}

describe("checkpoint cleanup", () => {
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

  test("dry-run returns empty result when worktrees directory is missing", async () => {
    await expect(cleanupCheckpointStorage({ liveRefs: new Set(), apply: false })).resolves.toEqual({
      worktrees: [],
      deletedRefs: 0,
      removedStorage: 0,
    });
  });

  test("fails closed for unsafe worktree directory names", async () => {
    const unsafeDir = path.join(getCheckpointRootDir(), "worktrees", "not-safe");
    await fs.mkdir(unsafeDir, { recursive: true });

    await expect(cleanupCheckpointStorage({ liveRefs: new Set(), apply: false })).rejects.toThrow(
      "Unsafe worktree id",
    );
  });

  test("non-git worktree storage has no refs and can be removed", async () => {
    const worktreeId = "8".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    await fs.mkdir(path.join(repoDir, "repo.git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "repo.git", "note"), "not a git repo", "utf8");

    const dryRun = await cleanupCheckpointStorage({ liveRefs: new Set(), apply: false });
    expect(dryRun.worktrees[0]).toEqual(
      expect.objectContaining({ orphanRefs: [], expiredRefs: [], removedStorage: false }),
    );

    const applied = await cleanupCheckpointStorage({ liveRefs: new Set(), apply: true });
    expect(applied.removedStorage).toBe(1);
    await expect(fs.access(repoDir)).rejects.toBeDefined();
  });

  test("removing empty orphan storage rewrites the worktree registry", async () => {
    const removedWorktreeId = "a".repeat(64);
    const survivorWorktreeId = "b".repeat(64);
    const removedRepoDir = path.join(getCheckpointRootDir(), "worktrees", removedWorktreeId);
    const survivorRepoDir = path.join(getCheckpointRootDir(), "worktrees", survivorWorktreeId);
    await fs.mkdir(removedRepoDir, { recursive: true });
    await fs.mkdir(survivorRepoDir, { recursive: true });
    const registryPath = path.join(getCheckpointRootDir(), "worktrees.json");
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        worktrees: [
          {
            worktreeId: removedWorktreeId,
            realpath: "/removed",
            displayName: "removed",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
          {
            worktreeId: survivorWorktreeId,
            realpath: "/survivor",
            displayName: "survivor",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await cleanupCheckpointStorage({
      liveRefs: new Set(),
      protectedWorktreeIds: new Set([survivorWorktreeId]),
      apply: true,
    });

    const registry = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
      worktrees: readonly { worktreeId: string }[];
    };
    expect(registry.worktrees.map((entry) => entry.worktreeId)).toEqual([survivorWorktreeId]);
  });

  test("removes legacy session checkpoint storage", async () => {
    const legacyDir = getLegacySessionsDir();
    await fs.mkdir(path.join(legacyDir, "old"), { recursive: true });
    await fs.writeFile(path.join(legacyDir, "old", "file"), "x", "utf8");

    await cleanupLegacySessionCheckpointStorage();

    await expect(fs.access(legacyDir)).rejects.toBeDefined();
  });

  test("removes temporary checkpoint artifacts", async () => {
    const tmpArtifacts = path.join(getCheckpointRootDir(), "tmp", "fork-intents");
    await fs.mkdir(tmpArtifacts, { recursive: true });
    await fs.writeFile(path.join(tmpArtifacts, "intent.json"), "{}", "utf8");

    await cleanupTemporaryCheckpointArtifacts();

    await expect(fs.access(tmpArtifacts)).rejects.toBeDefined();
  });

  test("dry-run reports orphan refs without deleting them", async () => {
    const worktreeId = "a".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    const indexFile = path.join(repoDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });
    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await fs.writeFile(path.join(workTree, "a.txt"), "a", "utf8");
    const commit = await repo.checkpoint("entry-1");
    const ref = "refs/ayu/checkpoints/sessions/session/entry/before";
    await repo.updateRef(ref, commit);

    const result = await cleanupCheckpointStorage({ liveRefs: new Set(), apply: false });

    expect(result.deletedRefs).toBe(0);
    expect(result.worktrees[0]?.orphanRefs).toContain(ref);
    await expect(repo.hasCommit(commit)).resolves.toBe(true);
  });

  test("dry-run reports maxCount retention-expired refs", async () => {
    const worktreeId = "c".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    const indexFile = path.join(repoDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });
    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "a.txt"), "a", "utf8");
    const oldCommit = await repo.checkpoint("entry-1");
    const oldRef = "refs/ayu/checkpoints/sessions/session/old/before";
    await repo.updateRef(oldRef, oldCommit);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await fs.writeFile(path.join(workTree, "a.txt"), "b", "utf8");
    const newCommit = await repo.checkpoint("entry-2");
    const newRef = "refs/ayu/checkpoints/sessions/session/new/before";
    await repo.updateRef(newRef, newCommit);

    const result = await cleanupCheckpointStorage({
      liveRefs: new Set([oldRef, newRef]),
      retention: { enabled: true, maxAge: "30d", minRetention: "1d", maxCount: 1 },
      apply: false,
    });

    expect(result.worktrees[0]?.expiredRefs).toContain(oldRef);
    expect(result.worktrees[0]?.expiredRefs).not.toContain(newRef);
  });

  test("maxCount expires before and after refs for the same checkpoint", async () => {
    const worktreeId = "7".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    const indexFile = path.join(repoDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });
    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "old.txt"), "old", "utf8");
    const oldCommit = await repo.checkpoint("entry-1");
    const oldBefore = "refs/ayu/checkpoints/sessions/session/old/before";
    const oldAfter = "refs/ayu/checkpoints/sessions/session/old/after";
    await repo.updateRef(oldBefore, oldCommit);
    await repo.updateRef(oldAfter, oldCommit);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await fs.writeFile(path.join(workTree, "new.txt"), "new", "utf8");
    const newCommit = await repo.checkpoint("entry-2");
    const newBefore = "refs/ayu/checkpoints/sessions/session/new/before";
    await repo.updateRef(newBefore, newCommit);

    const result = await cleanupCheckpointStorage({
      liveRefs: new Set([oldBefore, oldAfter, newBefore]),
      retention: { enabled: true, maxAge: "30d", minRetention: "1d", maxCount: 1 },
      apply: false,
    });

    expect(result.worktrees[0]?.expiredRefs).toEqual(expect.arrayContaining([oldBefore, oldAfter]));
  });

  test("skips locked worktree storage", async () => {
    const worktreeId = "d".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    await fs.mkdir(repoDir, { recursive: true });

    let releaseLock: (() => void) | undefined;
    const locked = withRepoLock(repoDir, async () => {
      await new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = await cleanupCheckpointStorage({ liveRefs: new Set(), apply: true });
    releaseLock?.();
    await locked;

    expect(result.worktrees[0]?.skippedLocked).toBe(true);
  });

  test("apply removes empty orphan worktree storage", async () => {
    const worktreeId = "e".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    await fs.mkdir(repoDir, { recursive: true });

    const result = await cleanupCheckpointStorage({ liveRefs: new Set(), apply: true });

    expect(result.removedStorage).toBe(1);
    expect(result.worktrees[0]?.removedStorage).toBe(true);
    await expect(fs.access(repoDir)).rejects.toBeDefined();
  });

  test("apply keeps empty protected active worktree storage", async () => {
    const worktreeId = "9".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    await fs.mkdir(repoDir, { recursive: true });

    const result = await cleanupCheckpointStorage({
      liveRefs: new Set(),
      protectedWorktreeIds: new Set([worktreeId]),
      apply: true,
    });

    expect(result.removedStorage).toBe(0);
    expect(result.worktrees[0]?.removedStorage).toBe(false);
    await expect(fs.access(repoDir)).resolves.toBeUndefined();
  });

  test("apply removes invalid orphan worktree storage", async () => {
    const worktreeId = "6".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    await fs.mkdir(gitDir, { recursive: true });

    const result = await cleanupCheckpointStorage({ liveRefs: new Set(), apply: true });

    expect(result.removedStorage).toBe(1);
    expect(result.worktrees[0]?.removedStorage).toBe(true);
    await expect(fs.access(repoDir)).rejects.toBeDefined();
  });

  test("fails closed when checkpoint refs cannot be listed from a valid repo", async () => {
    const worktreeId = "f".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    await fs.mkdir(gitDir, { recursive: true });

    const error = new Error("for-each-ref failed");
    const execModule = await import("./exec");
    const execSpy = vi.spyOn(execModule, "exec").mockImplementation(async (_command, args) => {
      if (args.includes("rev-parse")) return { stdout: gitDir, stderr: "" };
      throw error;
    });

    await expect(cleanupCheckpointStorage({ liveRefs: new Set(), apply: true })).rejects.toThrow(
      "for-each-ref failed",
    );
    await expect(fs.access(repoDir)).resolves.toBeUndefined();

    execSpy.mockRestore();
  });

  test("apply deletes nothing when a later worktree has unsafe refs", async () => {
    const firstWorktreeId = "1".repeat(64);
    const secondWorktreeId = "2".repeat(64);
    const firstRepoDir = path.join(getCheckpointRootDir(), "worktrees", firstWorktreeId);
    const secondRepoDir = path.join(getCheckpointRootDir(), "worktrees", secondWorktreeId);
    const firstGitDir = path.join(firstRepoDir, "repo.git");
    const secondGitDir = path.join(secondRepoDir, "repo.git");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const firstRepo = new RepoManager(firstGitDir, path.join(firstRepoDir, "index"), workTree);
    await firstRepo.init();
    await fs.writeFile(path.join(workTree, "a.txt"), "a", "utf8");
    const firstCommit = await firstRepo.checkpoint("entry-1");
    const firstRef = "refs/ayu/checkpoints/sessions/session/entry/before";
    await firstRepo.updateRef(firstRef, firstCommit);

    const secondRepo = new RepoManager(secondGitDir, path.join(secondRepoDir, "index"), workTree);
    await secondRepo.init();
    await fs.mkdir(
      path.join(secondGitDir, "refs", "ayu", "checkpoints", "sessions", "raw", "slash", "extra"),
      { recursive: true },
    );
    await fs.writeFile(
      path.join(
        secondGitDir,
        "refs",
        "ayu",
        "checkpoints",
        "sessions",
        "raw",
        "slash",
        "extra",
        "before",
      ),
      `${firstCommit}\n`,
      "utf8",
    );

    await expect(cleanupCheckpointStorage({ liveRefs: new Set(), apply: true })).rejects.toThrow(
      "Unsafe checkpoint ref",
    );

    const { stdout } = await exec("git", [`--git-dir=${firstGitDir}`, "rev-parse", firstRef]);
    expect(stdout.trim()).toBe(firstCommit);
  });

  test("apply deletes orphan refs and keeps protected refs", async () => {
    const worktreeId = "b".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    const indexFile = path.join(repoDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });
    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await fs.writeFile(path.join(workTree, "a.txt"), "a", "utf8");
    const commit = await repo.checkpoint("entry-1");
    const orphanRef = "refs/ayu/checkpoints/sessions/session/entry/before";
    const protectedRef = "refs/ayu/checkpoints/sessions/session/entry/after";
    await repo.updateRef(orphanRef, commit);
    await repo.updateRef(protectedRef, commit);

    const result = await cleanupCheckpointStorage({
      liveRefs: new Set([protectedRef]),
      protectedRefs: new Set([protectedRef]),
      apply: true,
    });

    expect(result.deletedRefs).toBe(1);
    const after = await cleanupCheckpointStorage({
      liveRefs: new Set([protectedRef]),
      apply: false,
    });
    expect(after.worktrees[0]?.orphanRefs).not.toContain(orphanRef);
    expect(after.worktrees[0]?.orphanRefs).not.toContain(protectedRef);
  });

  test("apply scopes live refs to their worktree when provided", async () => {
    const liveWorktreeId = "4".repeat(64);
    const orphanWorktreeId = "5".repeat(64);
    const liveRepoDir = path.join(getCheckpointRootDir(), "worktrees", liveWorktreeId);
    const orphanRepoDir = path.join(getCheckpointRootDir(), "worktrees", orphanWorktreeId);
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const liveRepo = new RepoManager(
      path.join(liveRepoDir, "repo.git"),
      path.join(liveRepoDir, "index"),
      workTree,
    );
    await liveRepo.init();
    await fs.writeFile(path.join(workTree, "a.txt"), "a", "utf8");
    const liveCommit = await liveRepo.checkpoint("entry-1");

    const orphanRepo = new RepoManager(
      path.join(orphanRepoDir, "repo.git"),
      path.join(orphanRepoDir, "index"),
      workTree,
    );
    await orphanRepo.init();
    await fs.writeFile(path.join(workTree, "a.txt"), "b", "utf8");
    const orphanCommit = await orphanRepo.checkpoint("entry-1");

    const sameRef = "refs/ayu/checkpoints/sessions/session/entry/before";
    await liveRepo.updateRef(sameRef, liveCommit);
    await orphanRepo.updateRef(sameRef, orphanCommit);

    const result = await cleanupCheckpointStorage({
      liveRefs: new Set([sameRef]),
      liveRefsByWorktree: new Map([[liveWorktreeId, new Set([sameRef])]]),
      apply: true,
    });

    expect(result.deletedRefs).toBe(1);
    await expect(liveRepo.hasCommit(liveCommit)).resolves.toBe(true);
    await expect(orphanRepo.hasCommit(orphanCommit)).resolves.toBe(false);
  });

  test("apply deletes orphan refs and keeps protected objects reachable", async () => {
    const worktreeId = "3".repeat(64);
    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const gitDir = path.join(repoDir, "repo.git");
    const indexFile = path.join(repoDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });
    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "old.txt"), "old", "utf8");
    const oldCommit = await repo.checkpoint("old");
    const oldRef = "refs/ayu/checkpoints/sessions/session/old/before";
    await repo.updateRef(oldRef, oldCommit);

    await fs.rm(path.join(workTree, "old.txt"));
    await fs.writeFile(path.join(workTree, "new.txt"), "new", "utf8");
    const newCommit = await repo.checkpoint("new");
    const newRef = "refs/ayu/checkpoints/sessions/session/new/before";
    await repo.updateRef(newRef, newCommit);

    const result = await cleanupCheckpointStorage({
      liveRefs: new Set([newRef]),
      protectedRefs: new Set([newRef]),
      apply: true,
    });

    expect(result.deletedRefs).toBe(1);
    await expect(repo.hasCommit(newCommit)).resolves.toBe(true);
    await expect(exec("git", [`--git-dir=${gitDir}`, "rev-parse", oldRef])).rejects.toThrow();
  });
});
