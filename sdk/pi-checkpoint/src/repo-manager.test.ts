import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RepoManager } from "./repo-manager";
import { exec } from "./exec";

async function createTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-checkpoint-test-"));
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("RepoManager", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await cleanup(tmpDir);
  });

  test("user can initialize a checkpoint repo", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    const configPath = path.join(gitDir, "config");
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);

    expect(configExists).toBe(true);

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["rev-parse", "--git-dir"], env);
    expect(stdout.trim()).toBe(gitDir);
  });

  test("user can checkpoint file changes", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "hello.txt"), "world", "utf8");

    const hash = await repo.checkpoint("entry-1");

    expect(hash).toBeTruthy();
    expect(hash.length).toBe(40);

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["log", "--format=%s", "-1"], env);
    expect(stdout.trim()).toBe("[pi] entry:entry-1");

    const { stdout: files } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(files.trim()).toBe("hello.txt");
  });

  test("user can restore files to a previous checkpoint", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    const filePath = path.join(workTree, "data.txt");
    await fs.writeFile(filePath, "version-1", "utf8");
    const cp1 = await repo.checkpoint("entry-1");

    await fs.writeFile(filePath, "version-2", "utf8");
    await repo.checkpoint("entry-2");

    await repo.checkoutCommit(cp1);

    const restored = await fs.readFile(filePath, "utf8");
    expect(restored).toBe("version-1");
  });

  test("user can see file change statistics for a checkpoint", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    const filePath = path.join(workTree, "data.txt");
    await fs.writeFile(filePath, "line1\nline2\nline3\n", "utf8");
    await repo.checkpoint("entry-1");

    await fs.writeFile(filePath, "line1\nline2-modified\nline3\nline4\n", "utf8");
    const cp2 = await repo.checkpoint("entry-2");

    const stats = await repo.diffStats(cp2);
    expect(stats).toContain("data.txt");
    // Format: "<added>\t<removed>\tdata.txt"
    // line2 modified (+1 -1), line4 added (+1) => 2 added, 1 removed
    const parts = stats.trim().split("\t");
    expect(parts[0]).toBe("2"); // added
    expect(parts[1]).toBe("1"); // removed
    expect(parts[2]).toBe("data.txt");
  });

  test("user can clone a repo so that child session works independently", async () => {
    const srcGitDir = path.join(tmpDir, "src", ".git");
    const srcIndex = path.join(tmpDir, "src", "index");
    const srcWork = path.join(tmpDir, "src", "project");
    await fs.mkdir(srcWork, { recursive: true });

    const srcRepo = new RepoManager(srcGitDir, srcIndex, srcWork);
    await srcRepo.init();

    await fs.writeFile(path.join(srcWork, "a.txt"), "a", "utf8");
    await srcRepo.checkpoint("entry-1");

    const dstGitDir = path.join(tmpDir, "dst", ".git");
    const dstIndex = path.join(tmpDir, "dst", "index");
    const dstWork = path.join(tmpDir, "dst", "project");
    await fs.mkdir(dstWork, { recursive: true });

    await RepoManager.cloneFrom(srcGitDir, dstGitDir);

    const dstRepo = new RepoManager(dstGitDir, dstIndex, dstWork);
    await dstRepo.checkoutCommit("HEAD");

    await fs.writeFile(path.join(dstWork, "b.txt"), "b", "utf8");
    const dstHash = await dstRepo.checkpoint("entry-2");

    // Verify dst has the new commit
    expect(dstHash).toBeTruthy();

    // Verify src does NOT have dst's commit
    const env = { GIT_DIR: srcGitDir, GIT_WORK_TREE: srcWork, GIT_INDEX_FILE: srcIndex };
    const { stdout } = await exec("git", ["log", "--format=%s"], env);
    expect(stdout).not.toContain("entry-2");
    expect(stdout).toContain("entry-1");
  }, 15000);

  test("user can create a safety commit", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "safety.txt"), "data", "utf8");
    const hash = await repo.createSafetyCommit();

    expect(hash).toBeTruthy();
    expect(hash.length).toBe(40);

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["log", "--format=%s", "-1"], env);
    expect(stdout.trim()).toBe("[pi] safety");
  });

  test("user can update a ref", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "ref.txt"), "a", "utf8");
    const cp1 = await repo.checkpoint("entry-1");

    await repo.updateRef("refs/heads/test-branch", cp1);

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["rev-parse", "refs/heads/test-branch"], env);
    expect(stdout.trim()).toBe(cp1);
  });

  test("diffStats falls back to git show for first commit", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "first.txt"), "hello", "utf8");
    const cp1 = await repo.checkpoint("entry-1");

    const stats = await repo.diffStats(cp1);
    expect(stats).toContain("first.txt");
  });

  test("diffWorkingTree compares commit against working tree", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.writeFile(path.join(workTree, "a.txt"), "line1\n", "utf8");
    const cp1 = await repo.checkpoint("entry-1");

    await fs.writeFile(path.join(workTree, "a.txt"), "line1\nline2\n", "utf8");
    const stats = await repo.diffWorkingTree(cp1);

    expect(stats).toContain("a.txt");
    const parts = stats.trim().split("\t");
    expect(parts[0]).toBe("1"); // added
    expect(parts[1]).toBe("0"); // removed
    expect(parts[2]).toBe("a.txt");
  });

  test("setExclude writes patterns to git info/exclude", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await repo.setExclude(["node_modules/**", "*.log"]);

    const excludePath = path.join(gitDir, "info", "exclude");
    const content = await fs.readFile(excludePath, "utf8");
    expect(content).toContain("node_modules/**");
    expect(content).toContain("*.log");
  });

  test("withLock serialises access through filesystem lock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    const order: number[] = [];

    const p1 = repo.withLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return "a";
    });

    // Ensure p1 acquires the lock before p2 starts competing.
    await new Promise((r) => setTimeout(r, 10));

    const p2 = repo.withLock(async () => {
      order.push(3);
      return "b";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(order).toEqual([1, 2, 3]);
  });

  describe("safeCheckout", () => {
    test("blocks when workspace has unsnapshotted changes (dirty guard)", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Unsnapshotted change
      await fs.writeFile(path.join(workTree, "a.txt"), "v2", "utf8");

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({ ok: false, reason: "dirty" });

      // File must remain untouched
      const content = await fs.readFile(path.join(workTree, "a.txt"), "utf8");
      expect(content).toBe("v2");
    });

    test("proceeds when dirty guard diff fails", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Pass an invalid commit hash so diffAgainst throws
      const result = await repo.safeCheckout(cp1, "deadbeef");
      expect(result.ok).toBe(true);
    });

    test("checks out target commit and returns safety hash", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Leave an unstaged change so the safety commit has something to capture.
      await fs.writeFile(path.join(workTree, "b.txt"), "extra", "utf8");

      // No dirtyBaseCommit — skip the dirty guard entirely.
      const result = await repo.safeCheckout(cp1);
      expect(result.ok).toBe(true);
      expect(typeof (result as { ok: true; safetyHash?: string }).safetyHash).toBe("string");

      const content = await fs.readFile(path.join(workTree, "a.txt"), "utf8");
      expect(content).toBe("v1");
    });

    test("rolls back to safety commit on checkout failure", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      const spy = vi.spyOn(repo, "checkoutCommit").mockRejectedValueOnce(new Error("git error"));

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "git error",
      });

      spy.mockRestore();
    });

    test("rolls back when checkout fails with non-Error", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Leave an unstaged change so createSafetyCommit succeeds.
      await fs.writeFile(path.join(workTree, "b.txt"), "extra", "utf8");

      const spy = vi
        .spyOn(repo, "checkoutCommit")
        .mockRejectedValueOnce("string error")
        .mockResolvedValueOnce(undefined);

      const result = await repo.safeCheckout(cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "string error",
      });

      spy.mockRestore();
    });

    test("reports rollback error when rollback also fails", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Leave an unstaged change so createSafetyCommit succeeds.
      await fs.writeFile(path.join(workTree, "b.txt"), "extra", "utf8");

      const spy = vi.spyOn(repo, "checkoutCommit").mockImplementation(async (hash: string) => {
        if (hash === cp1) throw new Error("git error");
        throw new Error("rollback error");
      });

      // No dirtyBaseCommit — skip the dirty guard entirely.
      const result = await repo.safeCheckout(cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "git error",
        rollbackError: "rollback error",
      });

      spy.mockRestore();
    });

    test("fails gracefully when safety commit cannot be created", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      const spy = vi
        .spyOn(repo, "createSafetyCommit")
        .mockRejectedValueOnce(new Error("safety fail"));

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result.ok).toBe(true);

      spy.mockRestore();
    });

    test("fails without rollback when checkout fails and no safety commit", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      vi.spyOn(repo, "createSafetyCommit").mockRejectedValueOnce(new Error("safety fail"));
      const checkoutSpy = vi
        .spyOn(repo, "checkoutCommit")
        .mockRejectedValueOnce(new Error("git error"));

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "git error",
      });

      checkoutSpy.mockRestore();
    });

    test("checkout failure reports string error", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      vi.spyOn(repo, "createSafetyCommit").mockRejectedValueOnce(new Error("safety fail"));
      const checkoutSpy = vi.spyOn(repo, "checkoutCommit").mockRejectedValueOnce("string error");

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "string error",
      });

      checkoutSpy.mockRestore();
    });

    test("rollback failure reports string error", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Leave an unstaged change so createSafetyCommit succeeds.
      await fs.writeFile(path.join(workTree, "b.txt"), "extra", "utf8");

      const spy = vi.spyOn(repo, "checkoutCommit").mockImplementation(async (hash: string) => {
        if (hash === cp1) throw new Error("git error");
        throw "string rollback";
      });

      const result = await repo.safeCheckout(cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "git error",
        rollbackError: "string rollback",
      });

      spy.mockRestore();
    });

    test("checkout and rollback both fail with non-Error", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Leave an unstaged change so createSafetyCommit succeeds.
      await fs.writeFile(path.join(workTree, "b.txt"), "extra", "utf8");

      const spy = vi.spyOn(repo, "checkoutCommit").mockImplementation(async (hash: string) => {
        if (hash === cp1) throw "string error";
        throw "string rollback";
      });

      const result = await repo.safeCheckout(cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        error: "string error",
        rollbackError: "string rollback",
      });

      spy.mockRestore();
    });
  });
});
