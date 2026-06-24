import { describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getGitDir, getRepoDir } from "./resolver";
import { createMockRepo } from "./testing";
import { bindSessionRepo } from "./session-repo-binder";
import { createDefaultRepoProvider } from "./repo-provider";

describe("repo provider", () => {
  test("default provider stores and deletes repos", () => {
    const provider = createDefaultRepoProvider();
    const repo = createMockRepo();

    expect(provider.getRepo("session-1")).toBeUndefined();

    provider.setRepo("session-1", repo);
    expect(provider.getRepo("session-1")).toBe(repo);

    provider.deleteRepo("session-1");
    expect(provider.getRepo("session-1")).toBeUndefined();
  });

  test("bindSessionRepo returns an existing repo without resolving storage", async () => {
    const repo = createMockRepo();
    const provider = {
      getRepo: vi.fn().mockReturnValue(repo),
      setRepo: vi.fn(),
      deleteRepo: vi.fn(),
    };

    await expect(bindSessionRepo("session-1", undefined, process.cwd(), provider)).resolves.toBe(
      repo,
    );
    expect(provider.setRepo).not.toHaveBeenCalled();
  });

  test("bindSessionRepo returns undefined when no existing storage is available", async () => {
    const provider = createDefaultRepoProvider();

    await expect(bindSessionRepo("session-1", undefined, process.cwd(), provider)).resolves.toBe(
      undefined,
    );
  });

  test("bindSessionRepo binds resolved checkpoint storage", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-provider-test-"));
    try {
      const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "existing.jsonl");
      await fs.mkdir(getGitDir(getRepoDir(sessionFile)), { recursive: true });
      const provider = createDefaultRepoProvider();

      const repo = await bindSessionRepo("session-1", sessionFile, tmpDir, provider);

      expect(repo).toBeDefined();
      expect(provider.getRepo("session-1")).toBe(repo);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bindSessionRepo ensures and binds storage when exclude patterns are provided", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-provider-test-"));
    try {
      const sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "ensure.jsonl");
      const provider = createDefaultRepoProvider();

      const repo = await bindSessionRepo("session-ensure", sessionFile, tmpDir, provider, {
        exclude: ["node_modules/**"],
      });

      expect(repo).toBeDefined();
      expect(provider.getRepo("session-ensure")).toBe(repo);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
