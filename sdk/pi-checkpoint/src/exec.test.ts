import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec, type ExecEnv } from "./exec";

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pi-exec-test-"));
}

describe("exec", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("user can run git commands in directories with spaces", async () => {
    const dirWithSpace = path.join(tmpDir, "my project");
    await fs.mkdir(dirWithSpace, { recursive: true });

    const env: ExecEnv = {
      GIT_DIR: path.join(dirWithSpace, ".git"),
      GIT_WORK_TREE: dirWithSpace,
      GIT_INDEX_FILE: path.join(dirWithSpace, "index"),
    };

    await exec("git", ["init", "--bare", env.GIT_DIR]);
    await exec("git", ["config", "user.email", "test@test.com"], env);

    const { stdout } = await exec("git", ["config", "user.email"], env);
    expect(stdout.trim()).toBe("test@test.com");
  });

  test("user can run git commands with file paths containing spaces", async () => {
    const dirWithSpace = path.join(tmpDir, "project name");
    await fs.mkdir(dirWithSpace, { recursive: true });

    const env: ExecEnv = {
      GIT_DIR: path.join(dirWithSpace, ".git"),
      GIT_WORK_TREE: dirWithSpace,
      GIT_INDEX_FILE: path.join(tmpDir, "project name.index"), // keep index outside workTree
    };

    await exec("git", ["init", "--bare", env.GIT_DIR]);
    await fs.writeFile(path.join(dirWithSpace, "hello world.txt"), "content", "utf8");
    await exec("git", ["add", "-A"], env);
    await exec("git", ["commit", "-m", "test"], env);

    const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", "HEAD"], env);
    expect(stdout.trim()).toBe("hello world.txt");
  });

  test("throws when command exits with non-zero code", async () => {
    await expect(exec("git", ["not-a-real-command"])).rejects.toThrow();
  });

  test("rejects when command is not found", async () => {
    await expect(exec("not-a-real-command-xyz", [])).rejects.toThrow();
  });

  test("execSafe returns error Result when command exits non-zero", async () => {
    const { execSafe } = await import("./exec");
    const result = await execSafe("git", ["not-a-real-command"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not-a-real-command");
    }
  });

  test("execSafe returns error Result when command not found", async () => {
    const { execSafe } = await import("./exec");
    const result = await execSafe("not-a-real-command-xyz", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
    }
  });

  test("execSafe returns ok Result on success", async () => {
    const { execSafe } = await import("./exec");
    const result = await execSafe("git", ["--version"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stdout).toContain("git version");
    }
  });
});
