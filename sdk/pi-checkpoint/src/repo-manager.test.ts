import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isWindowsReservedDevicePath, RepoManager } from "./repo-manager";
import { exec } from "./exec";

async function createTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-checkpoint-test-"));
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === "EBUSY" || code === "EPERM") && i < 4) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

const windowsTest = process.platform === "win32" ? test : test.skip;

describe("isWindowsReservedDevicePath", () => {
  test.each([
    "CON",
    "nul",
    "NUL.txt",
    "AUX. ",
    "nested/COM1.log",
    "nested\\LPT9",
    "COM¹",
    "LPT³.txt",
  ])("recognizes %s", (filePath) => {
    expect(isWindowsReservedDevicePath(filePath)).toBe(true);
  });

  test.each(["NULL", "NUL-safe", "COM0", "COM10", "LPT0", "LPT10", "file.txt"])(
    "does not match %s",
    (filePath) => {
      expect(isWindowsReservedDevicePath(filePath)).toBe(false);
    },
  );
});

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

  test("checkpoint treats .gitignore as an ordinary file outside a git repository", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const ignoredDir = path.join(workTree, "ignored");
    await fs.mkdir(ignoredDir, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude(["*.log"]);
    await fs.writeFile(path.join(workTree, ".gitignore"), "ignored/\n", "utf8");
    await fs.writeFile(path.join(ignoredDir, "captured.txt"), "captured", "utf8");
    await fs.writeFile(path.join(workTree, "excluded.log"), "excluded", "utf8");

    const hash = await repo.checkpoint("entry-1");

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(stdout.split("\n").filter(Boolean)).toEqual([".gitignore", "ignored/captured.txt"]);
  });

  test("checkpoint respects .gitignore inside a git repository", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const ignoredDir = path.join(workTree, "ignored");
    await fs.mkdir(ignoredDir, { recursive: true });
    await exec("git", ["init"], undefined, workTree);

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await fs.writeFile(path.join(workTree, ".gitignore"), "ignored/\n", "utf8");
    await fs.writeFile(path.join(ignoredDir, "ignored.txt"), "ignored", "utf8");

    const hash = await repo.checkpoint("entry-1");

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(stdout.split("\n").filter(Boolean)).toEqual([".gitignore"]);
  });

  test("reuses an unchanged baseline without creating an empty checkpoint commit", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await fs.writeFile(path.join(workTree, "hello.txt"), "world", "utf8");
    const baseline = await repo.checkpoint("entry-1");
    const stageAll = vi.spyOn(repo, "stageAll");

    const checkpoint = await repo.checkpointIfChanged("entry-2", baseline);

    expect(checkpoint).toBe(baseline);
    expect(stageAll).toHaveBeenCalledTimes(1);
    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["rev-list", "--count", "HEAD"], env);
    expect(stdout.trim()).toBe("1");
  });

  test("captures changes made after a baseline checkpoint", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    const filePath = path.join(workTree, "hello.txt");
    await fs.writeFile(filePath, "before", "utf8");
    const baseline = await repo.checkpoint("entry-1");
    await fs.writeFile(filePath, "manual change", "utf8");

    const checkpoint = await repo.checkpointIfChanged("entry-2", baseline);

    expect(checkpoint).not.toBe(baseline);
    await repo.checkoutCommit(checkpoint);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("manual change");
  });

  test("checkpoint excludes nested git repositories", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const nestedRepo = path.join(workTree, "nested", "repo");
    await fs.mkdir(nestedRepo, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await exec("git", ["init"], undefined, nestedRepo);

    await fs.writeFile(path.join(workTree, "root.txt"), "tracked", "utf8");
    await fs.writeFile(path.join(nestedRepo, "ignored.txt"), "ignored", "utf8");

    await repo.ensureReady(["node_modules/**"]);
    const hash = await repo.checkpoint("entry-1");

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = await fs.readFile(excludePath, "utf8");
    expect(exclude).toContain("nested/repo/");

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(stdout.trim()).toBe("root.txt");
  });

  test("checkpoint refreshes nested git repository excludes before staging", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const nestedRepo = path.join(workTree, "nested", "repo");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await fs.writeFile(path.join(workTree, "root.txt"), "tracked", "utf8");

    await repo.ensureReady([]);
    await repo.checkpoint("entry-1");

    await fs.mkdir(nestedRepo, { recursive: true });
    await exec("git", ["init"], undefined, nestedRepo);
    await exec("git", ["config", "user.email", "nested@example.test"], undefined, nestedRepo);
    await exec("git", ["config", "user.name", "Nested Repo"], undefined, nestedRepo);
    await fs.writeFile(path.join(nestedRepo, "nested.txt"), "nested", "utf8");
    await exec("git", ["add", "nested.txt"], undefined, nestedRepo);
    await exec("git", ["commit", "-m", "nested"], undefined, nestedRepo);

    const hash = await repo.checkpoint("entry-2");

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = await fs.readFile(excludePath, "utf8");
    expect(exclude).toContain("nested/repo/");

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(stdout.trim()).toBe("root.txt");
  });

  test("setExclude excludes nested git repositories with git file markers", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const nestedRepo = path.join(workTree, "nested", "repo");
    await fs.mkdir(nestedRepo, { recursive: true });
    await fs.writeFile(path.join(nestedRepo, ".git"), "gitdir: ../repo.git\n", "utf8");

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude([]);

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = await fs.readFile(excludePath, "utf8");
    expect(exclude).toContain("nested/repo/");
  });

  test("setExclude does not exclude the work tree root git repository", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });
    await exec("git", ["init"], undefined, workTree);

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude([]);

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = await fs.readFile(excludePath, "utf8");
    expect(exclude).not.toContain("project/");
    if (process.platform === "win32") {
      expect(exclude).toContain("NUL\n");
    } else {
      expect(exclude.trim()).toBe("");
    }
  });

  windowsTest("Windows device exclusions override user include rules", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude(["!NUL", "!nested/COM1.log"]);

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    for (const candidate of ["NUL", "nul.txt", "nested/COM1.log", "LPT9. "]) {
      await expect(
        exec("git", ["check-ignore", "--no-index", "-q", "--", candidate], env, workTree),
      ).resolves.toBeDefined();
    }
    await expect(
      exec("git", ["check-ignore", "--no-index", "-q", "--", "NUL-safe"], env, workTree),
    ).rejects.toThrow();
  });

  windowsTest("checkpoint clears Windows device names left in the checkpoint index", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude(["!NUL"]);
    await fs.writeFile(path.join(workTree, "seed.txt"), "seed", "utf8");
    await fs.writeFile(path.join(workTree, "normal.txt"), "normal", "utf8");

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout: blobHash } = await exec(
      "git",
      ["hash-object", "-w", "seed.txt"],
      env,
      workTree,
    );
    for (const reservedPath of ["NUL", "nested/COM1.log", "nul.txt"]) {
      await exec(
        "git",
        [
          "-c",
          "core.protectNTFS=false",
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blobHash.trim()},${reservedPath}`,
        ],
        env,
        workTree,
      );
    }

    const hash = await repo.checkpoint("entry-device-index");
    const { stdout: files } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(files).toContain("normal.txt");
    expect(files).not.toMatch(/(?:^|\n)(?:NUL|nul\.txt|nested\/COM1\.log)(?:\n|$)/);
  });

  test("setExclude scans node_modules when node_modules is not excluded", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const nestedRepo = path.join(workTree, "node_modules", "pkg");
    await fs.mkdir(nestedRepo, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await exec("git", ["init"], undefined, nestedRepo);

    await repo.setExclude([]);

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = await fs.readFile(excludePath, "utf8");
    expect(exclude).toContain("node_modules/pkg/");
  });

  test("setExclude prunes node_modules when node_modules is excluded", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const nestedRepo = path.join(workTree, "node_modules", "pkg");
    await fs.mkdir(nestedRepo, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await exec("git", ["init"], undefined, nestedRepo);

    await repo.setExclude(["**/node_modules/**"]);

    const excludePath = path.join(gitDir, "info", "exclude");
    const exclude = await fs.readFile(excludePath, "utf8");
    expect(exclude).toContain("**/node_modules/**");
    expect(exclude).not.toContain("node_modules/pkg/");
  });

  test("checkpoint removes previously indexed nested git repositories", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    const nestedRepo = path.join(workTree, "nested", "repo");
    await fs.mkdir(nestedRepo, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await exec("git", ["init"], undefined, nestedRepo);
    await exec("git", ["config", "user.email", "nested@example.test"], undefined, nestedRepo);
    await exec("git", ["config", "user.name", "Nested Repo"], undefined, nestedRepo);
    await fs.writeFile(path.join(nestedRepo, "nested.txt"), "nested", "utf8");
    await exec("git", ["add", "nested.txt"], undefined, nestedRepo);
    await exec("git", ["commit", "-m", "nested"], undefined, nestedRepo);

    await fs.writeFile(path.join(workTree, "root.txt"), "tracked", "utf8");
    await repo.checkpoint("entry-1");

    await repo.ensureReady([]);
    const hash = await repo.checkpoint("entry-2");

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
    expect(stdout.trim()).toBe("root.txt");
    await expect(fs.access(path.join(nestedRepo, ".git"))).resolves.toBeUndefined();
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

    const dstEnv = { GIT_DIR: dstGitDir, GIT_WORK_TREE: dstWork, GIT_INDEX_FILE: dstIndex };
    const { stdout: clonedName } = await exec("git", ["config", "user.name"], dstEnv);
    expect(clonedName.trim()).toBe("Pi Checkpoint");

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

  test("setExclude skips directories that cannot be read", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "missing-project");

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await expect(repo.setExclude(["*.log"])).resolves.toBeUndefined();

    const excludePath = path.join(gitDir, "info", "exclude");
    const content = await fs.readFile(excludePath, "utf8");
    expect(content).toContain("*.log");
  });

  test("setExclude excludes internal checkpoint storage when repo lives inside the work tree", async () => {
    const workTree = path.join(tmpDir, "project");
    const gitDir = path.join(workTree, ".pi", "checkpoint", ".git");
    const indexFile = path.join(tmpDir, "index");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude(["*.log"]);

    const excludePath = path.join(gitDir, "info", "exclude");
    const content = await fs.readFile(excludePath, "utf8");
    expect(content).toContain("*.log");
    expect(content).toContain(".pi/checkpoint");
  });

  test("ensureReady does nothing when repo is intact", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    const spy = vi.spyOn(repo, "init");

    await repo.ensureReady();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("ensureReady refreshes exclude when repo is intact", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    const spy = vi.spyOn(repo, "setExclude");

    await repo.ensureReady(["**/node_modules/**"]);

    expect(spy).toHaveBeenCalledWith(["**/node_modules/**"]);
    spy.mockRestore();
  });

  test("ensureReady re-initialises repo when deleted", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();
    await repo.setExclude(["*.log"]);

    await fs.rm(gitDir, { recursive: true, force: true });

    await repo.ensureReady(["node_modules/**"]);

    const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
    const { stdout } = await exec("git", ["rev-parse", "--git-dir"], env);
    expect(stdout.trim()).toBe(gitDir);

    const excludePath = path.join(gitDir, "info", "exclude");
    const content = await fs.readFile(excludePath, "utf8");
    expect(content).toContain("node_modules/**");
  });

  test("ensureReady writes empty exclude when patterns are empty", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    await repo.init();

    await fs.rm(gitDir, { recursive: true, force: true });

    const spy = vi.spyOn(repo, "setExclude");

    await repo.ensureReady([]);

    expect(spy).toHaveBeenCalledWith([]);
    spy.mockRestore();
  });

  test("lockedCheckpoint runs checkpoint inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const checkpoint = vi.spyOn(repo, "checkpoint").mockResolvedValue("locked-checkpoint");

    const hash = await repo.lockedCheckpoint("entry-1");

    expect(lock).toHaveBeenCalledTimes(1);
    expect(checkpoint).toHaveBeenCalledWith("entry-1");
    expect(hash).toBe("locked-checkpoint");

    lock.mockRestore();
    checkpoint.mockRestore();
  });

  test("lockedCheckpoint throws when checkpoint is not mocked", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());

    await expect(repo.lockedCheckpoint("entry-1")).rejects.toThrow("checkpoint");
  });

  test("lockedInit runs init inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const init = vi.spyOn(repo, "init").mockResolvedValue(undefined);

    await repo.lockedInit();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);

    lock.mockRestore();
    init.mockRestore();
  });

  test("lockedEnsureReady runs ensureReady inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const ensureReady = vi.spyOn(repo, "ensureReady").mockResolvedValue(undefined);

    await repo.lockedEnsureReady(["*.log"]);

    expect(lock).toHaveBeenCalledTimes(1);
    expect(ensureReady).toHaveBeenCalledWith(["*.log"]);

    lock.mockRestore();
    ensureReady.mockRestore();
  });

  test("lockedCheckoutCommit runs checkout inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const checkoutCommit = vi.spyOn(repo, "checkoutCommit").mockResolvedValue(undefined);

    await repo.lockedCheckoutCommit("commit-hash");

    expect(lock).toHaveBeenCalledTimes(1);
    expect(checkoutCommit).toHaveBeenCalledWith("commit-hash");

    lock.mockRestore();
    checkoutCommit.mockRestore();
  });

  test("lockedUpdateRef runs updateRef inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const updateRef = vi.spyOn(repo, "updateRef").mockResolvedValue(undefined);

    await repo.lockedUpdateRef("refs/heads/test", "commit-hash");

    expect(lock).toHaveBeenCalledTimes(1);
    expect(updateRef).toHaveBeenCalledWith("refs/heads/test", "commit-hash");

    lock.mockRestore();
    updateRef.mockRestore();
  });

  test("lockedSetExclude runs setExclude inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const setExclude = vi.spyOn(repo, "setExclude").mockResolvedValue(undefined);

    await repo.lockedSetExclude(["*.log"]);

    expect(lock).toHaveBeenCalledTimes(1);
    expect(setExclude).toHaveBeenCalledWith(["*.log"]);

    lock.mockRestore();
    setExclude.mockRestore();
  });

  test("lockedCreateSafetyCommit runs createSafetyCommit inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const createSafetyCommit = vi
      .spyOn(repo, "createSafetyCommit")
      .mockResolvedValue("safety-hash");

    await expect(repo.lockedCreateSafetyCommit()).resolves.toBe("safety-hash");

    expect(lock).toHaveBeenCalledTimes(1);
    expect(createSafetyCommit).toHaveBeenCalledTimes(1);

    lock.mockRestore();
    createSafetyCommit.mockRestore();
  });

  test("lockedStageAll runs stageAll inside withLock", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const indexFile = path.join(tmpDir, "index");
    const workTree = path.join(tmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new RepoManager(gitDir, indexFile, workTree);
    const lock = vi.spyOn(repo, "withLock").mockImplementation(async (fn) => fn());
    const stageAll = vi.spyOn(repo, "stageAll").mockResolvedValue(undefined);

    await repo.lockedStageAll();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(stageAll).toHaveBeenCalledTimes(1);

    lock.mockRestore();
    stageAll.mockRestore();
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
      expect(result).toEqual({
        ok: false,
        reason: "dirty",
        message:
          "Workspace has checkpoint-managed changes that are not captured by the selected checkpoint base.\nChanged paths:\n- a.txt",
      });

      // File must remain untouched
      const content = await fs.readFile(path.join(workTree, "a.txt"), "utf8");
      expect(content).toBe("v2");
    });

    test("dirty guard summarizes additional changed paths", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"]) {
        await fs.writeFile(path.join(workTree, name), `${name}-v1`, "utf8");
      }
      const cp1 = await repo.checkpoint("entry-1");

      for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"]) {
        await fs.writeFile(path.join(workTree, name), `${name}-v2`, "utf8");
      }

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "dirty",
        message:
          "Workspace has checkpoint-managed changes that are not captured by the selected checkpoint base.\nChanged paths:\n- a.txt\n- b.txt\n- c.txt\n- d.txt\n- e.txt\n- ...and 1 more",
      });
    });

    test("dirty guard falls back to the generic dirty message when changed paths cannot be listed", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      vi.spyOn(repo, "diffAgainst").mockResolvedValue("M\t");
      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "dirty",
        message:
          "Workspace has checkpoint-managed changes that are not captured by the selected checkpoint base.",
      });
    });

    test("fails closed when dirty guard cannot verify the base commit", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      // Pass an invalid commit hash so the dirty guard cannot verify cleanliness.
      const result = await repo.safeCheckout(cp1, "deadbeef");
      expect(result).toEqual({
        ok: false,
        reason: "dirty-check-failed",
        message: "Could not verify the workspace is clean against the checkpoint base.",
      });
    });

    test("rejects path-safety, missing storage, and corrupt storage before checkout", async () => {
      const invalidRepo = new RepoManager(
        "",
        path.join(tmpDir, "index"),
        path.join(tmpDir, "project"),
      );
      await expect(invalidRepo.safeCheckout("abc")).resolves.toEqual({
        ok: false,
        reason: "path-safety-failed",
        message: "Checkpoint storage paths failed safety validation.",
      });

      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const missingRepo = new RepoManager(gitDir, indexFile, workTree);
      await expect(missingRepo.safeCheckout("abc")).resolves.toEqual({
        ok: false,
        reason: "storage-missing",
        message: "Checkpoint storage is missing.",
      });

      const corruptRepo = new RepoManager(gitDir, indexFile, workTree);
      await corruptRepo.init();
      await fs.rm(path.join(gitDir, "HEAD"), { force: true });
      const corruptResult = await corruptRepo.safeCheckout("abc");
      expect(corruptResult).toMatchObject({
        ok: false,
        reason: "storage-corrupt",
        message: "Checkpoint storage is unreadable.",
      });
      expect(corruptResult.ok).toBe(false);
    });

    test("rejects invalid and missing target commits", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await expect(repo.safeCheckout("bad\ncommit")).resolves.toEqual({
        ok: false,
        reason: "invalid-target",
        message: "Checkpoint target is invalid.",
      });
      await expect(repo.safeCheckout("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).resolves.toEqual({
        ok: false,
        reason: "target-missing",
        message: "Checkpoint target does not exist.",
      });
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

    test("skips oversized changed files during staging when maxFileBytes is set", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();
      repo.setMaxFileBytes(5);

      await fs.writeFile(path.join(workTree, "small.txt"), "ok", "utf8");
      await fs.writeFile(path.join(workTree, "large.txt"), "this is too large", "utf8");
      const hash = await repo.checkpoint("entry-oversized");

      const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: indexFile };
      const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", hash], env);
      expect(stdout).toContain("small.txt");
      expect(stdout).not.toContain("large.txt");
    });

    test("fails dirty-check closed when diffAgainst throws after staging", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      vi.spyOn(repo, "diffAgainst").mockRejectedValueOnce(new Error("diff fail"));
      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "dirty-check-failed",
        message: "Could not verify the workspace is clean against the checkpoint base.",
        error: "diff fail",
      });
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
        message: "Checkpoint restore failed.",
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
        message: "Checkpoint restore failed.",
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
        reason: "rollback-failed",
        message: "Checkpoint restore failed and rollback could not recover the previous state.",
        error: "git error",
        rollbackError: "rollback error",
      });

      spy.mockRestore();
    });

    test("fails closed when safety commit cannot be created", async () => {
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
      expect(result).toEqual({
        ok: false,
        reason: "preflight-failed",
        message: "Failed to create a safety checkpoint before restore.",
        error: "safety fail",
      });

      spy.mockRestore();
    });

    test("returns preflight failure before checkout when safety commit creation fails", async () => {
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
        reason: "preflight-failed",
        message: "Failed to create a safety checkpoint before restore.",
        error: "safety fail",
      });
      expect(checkoutSpy).not.toHaveBeenCalled();

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

      const checkoutSpy = vi.spyOn(repo, "checkoutCommit").mockRejectedValueOnce("string error");

      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "checkout-failed",
        message: "Checkpoint restore failed.",
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
        reason: "rollback-failed",
        message: "Checkpoint restore failed and rollback could not recover the previous state.",
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
        reason: "rollback-failed",
        message: "Checkpoint restore failed and rollback could not recover the previous state.",
        error: "string error",
        rollbackError: "string rollback",
      });

      spy.mockRestore();
    });

    test("fails when exclude refresh throws during dirty checking", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      const repoWithPrivate = repo as unknown as { refreshExclude: () => Promise<void> };
      vi.spyOn(repoWithPrivate, "refreshExclude").mockRejectedValueOnce(new Error("exclude fail"));
      const result = await repo.safeCheckout(cp1, cp1);
      expect(result).toEqual({
        ok: false,
        reason: "exclude-refresh-failed",
        message: "Failed to refresh checkpoint excludes before restore.",
        error: "exclude fail",
      });
    });

    test("fails when exclude refresh throws before checkout", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      const repoWithPrivate = repo as unknown as { refreshExclude: () => Promise<void> };
      vi.spyOn(repoWithPrivate, "refreshExclude")
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("exclude fail"));
      const result = await repo.safeCheckout(cp1);
      expect(result).toEqual({
        ok: false,
        reason: "exclude-refresh-failed",
        message: "Failed to refresh checkpoint excludes before restore.",
        error: "exclude fail",
      });
    });

    test("fails when repo lock acquisition throws", async () => {
      const gitDir = path.join(tmpDir, ".git");
      const indexFile = path.join(tmpDir, "index");
      const workTree = path.join(tmpDir, "project");
      await fs.mkdir(workTree, { recursive: true });

      const repo = new RepoManager(gitDir, indexFile, workTree);
      await repo.init();

      await fs.writeFile(path.join(workTree, "a.txt"), "v1", "utf8");
      const cp1 = await repo.checkpoint("entry-1");

      vi.spyOn(repo, "withLock").mockRejectedValueOnce(new Error("lock fail"));
      const result = await repo.safeCheckout(cp1);
      expect(result).toEqual({
        ok: false,
        reason: "lock-failed",
        message: "Failed to lock checkpoint storage for restore.",
        error: "lock fail",
      });
    });
  });
});

test("findLargeChangedPaths ignores files that disappear before stat completes", async () => {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.resetModules();
  vi.doMock("node:fs/promises", () => ({
    ...actualFs,
    stat: vi.fn(async (targetPath: Parameters<typeof actualFs.stat>[0]) => {
      if (String(targetPath).endsWith("large.txt")) throw new Error("missing");
      return actualFs.stat(targetPath);
    }),
  }));

  const { RepoManager: DynamicRepoManager } = await import("./repo-manager");
  const localTmpDir = await createTmpDir();
  try {
    const gitDir = path.join(localTmpDir, ".git");
    const indexFile = path.join(localTmpDir, "index");
    const workTree = path.join(localTmpDir, "project");
    await fs.mkdir(workTree, { recursive: true });

    const repo = new DynamicRepoManager(gitDir, indexFile, workTree);
    await repo.init();
    repo.setMaxFileBytes(5);

    await fs.writeFile(path.join(workTree, "large.txt"), "this is too large", "utf8");
    await repo.stageAll();
    const repoWithPrivate = repo as unknown as {
      findLargeChangedPaths: () => Promise<readonly string[]>;
    };
    await expect(repoWithPrivate.findLargeChangedPaths()).resolves.toEqual([]);
  } finally {
    vi.doUnmock("node:fs/promises");
    await cleanup(localTmpDir);
  }
});
