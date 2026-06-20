import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getGitDir,
  getIndexPath,
  getLegacySessionsDir,
  getRepoDir,
  getWorktreeId,
  getWorktreeRegistryPath,
  resolveWorktreeCheckpointStoragePaths,
} from "./resolver";

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "resolver-test-"));
}

describe("resolver", () => {
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

  test("getRepoDir keeps legacy session file base path", () => {
    const result = getRepoDir("/path/to/session-abc.jsonl");
    expect(result).toBe(path.join(getLegacySessionsDir(), "session-abc"));
  });

  test("getRepoDir falls back to legacy ephemeral when no session file", () => {
    const result = getRepoDir(undefined);
    expect(result).toBe(path.join(getLegacySessionsDir(), "ephemeral"));
  });

  test("getGitDir appends repo.git to repo dir", () => {
    expect(getGitDir("/repo")).toBe(path.join("/repo", "repo.git"));
  });

  test("getIndexPath appends index to repo dir", () => {
    expect(getIndexPath("/repo")).toBe(path.join("/repo", "index"));
  });

  test("worktree storage resolves by cwd realpath and writes registry", async () => {
    const worktree = path.join(tmpDir, "project");
    await fs.mkdir(worktree, { recursive: true });

    const paths = await resolveWorktreeCheckpointStoragePaths(worktree);
    const realpath = await fs.realpath(worktree);

    expect(paths.worktreeId).toBe(getWorktreeId(realpath));
    expect(paths.repoDir).toBe(
      path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "worktrees", paths.worktreeId),
    );
    expect(paths.gitDir).toBe(path.join(paths.repoDir, "repo.git"));
    expect(paths.indexFile).toBe(path.join(paths.repoDir, "index"));
    expect(paths.metadataPath).toBe(path.join(paths.repoDir, "metadata.json"));

    const registryRaw = await fs.readFile(getWorktreeRegistryPath(), "utf8");
    expect(registryRaw).toContain(paths.worktreeId);
    expect(registryRaw).toContain(realpath);

    const metadataRaw = await fs.readFile(paths.metadataPath, "utf8");
    expect(metadataRaw).toContain(paths.worktreeId);
    expect(metadataRaw).toContain(realpath);
  });

  test("worktree storage falls back to resolved path when realpath is unavailable", async () => {
    const missing = path.join(tmpDir, "missing-project");

    const paths = await resolveWorktreeCheckpointStoragePaths(missing);

    expect(paths.realpath).toBe(path.resolve(missing));
    expect(paths.worktreeId).toBe(getWorktreeId(path.resolve(missing)));
  });

  test("worktree registry ignores malformed existing registry", async () => {
    await fs.mkdir(path.dirname(getWorktreeRegistryPath()), { recursive: true });
    await fs.writeFile(getWorktreeRegistryPath(), JSON.stringify({ worktrees: "bad" }), "utf8");

    const paths = await resolveWorktreeCheckpointStoragePaths(tmpDir);
    const registry = JSON.parse(await fs.readFile(getWorktreeRegistryPath(), "utf8")) as {
      worktrees: readonly { worktreeId: string }[];
    };

    expect(registry.worktrees.map((entry) => entry.worktreeId)).toEqual([paths.worktreeId]);
  });

  test("registry entries are sorted by worktree id", async () => {
    const first = await resolveWorktreeCheckpointStoragePaths(path.join(tmpDir, "z-project"));
    const second = await resolveWorktreeCheckpointStoragePaths(path.join(tmpDir, "a-project"));
    const registry = JSON.parse(await fs.readFile(getWorktreeRegistryPath(), "utf8")) as {
      worktrees: readonly { worktreeId: string }[];
    };

    expect(registry.worktrees.map((entry) => entry.worktreeId)).toEqual(
      [first.worktreeId, second.worktreeId].sort(),
    );
  });

  test("uses full realpath as display name for filesystem root", async () => {
    const paths = await resolveWorktreeCheckpointStoragePaths(path.parse(tmpDir).root);
    const metadata = JSON.parse(await fs.readFile(paths.metadataPath, "utf8")) as {
      displayName: string;
    };
    const registry = JSON.parse(await fs.readFile(getWorktreeRegistryPath(), "utf8")) as {
      worktrees: readonly { worktreeId: string; displayName: string }[];
    };

    expect(metadata.displayName).toBe(paths.realpath);
    expect(
      registry.worktrees.find((entry) => entry.worktreeId === paths.worktreeId)?.displayName,
    ).toBe(paths.realpath);
  });
});
