import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultRepoProvider } from "./repo-provider";
import { bindSessionRepo } from "./session-repo-binder";

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-repo-binder-test-"));
}

describe("bindSessionRepo", () => {
  let tmpDir: string;
  let sessionFile: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "session.jsonl");
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, "", "utf8");
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns an existing bound repo", async () => {
    const repos = createDefaultRepoProvider();
    const created = await bindSessionRepo("session", sessionFile, tmpDir, repos, {
      exclude: [],
    });

    const rebound = await bindSessionRepo("session", sessionFile, tmpDir, repos);

    expect(rebound).toBe(created);
  });

  test("ensures and binds storage when exclude options are provided", async () => {
    const repos = createDefaultRepoProvider();

    const repo = await bindSessionRepo("session", sessionFile, tmpDir, repos, {
      exclude: ["node_modules/"],
      maxFileBytes: 1024,
    });

    expect(repo).toBeDefined();
    expect(repos.getRepo("session")).toBe(repo);
  });

  test("returns undefined when resolving missing storage without exclude options", async () => {
    const repos = createDefaultRepoProvider();

    const repo = await bindSessionRepo("session", sessionFile, tmpDir, repos);

    expect(repo).toBeUndefined();
    expect(repos.getRepo("session")).toBeUndefined();
  });

  test("resolves and binds existing storage without exclude options", async () => {
    const repos = createDefaultRepoProvider();
    await bindSessionRepo("creator", sessionFile, tmpDir, repos, { exclude: [] });
    const freshRepos = createDefaultRepoProvider();

    const repo = await bindSessionRepo("session", sessionFile, tmpDir, freshRepos);

    expect(repo).toBeDefined();
    expect(freshRepos.getRepo("session")).toBe(repo);
  });
});
