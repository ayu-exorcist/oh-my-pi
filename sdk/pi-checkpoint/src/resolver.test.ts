import { describe, test, expect } from "vitest";
import path from "node:path";
import { getRepoDir, getGitDir, getIndexPath } from "./resolver";

describe("resolver", () => {
  test("getRepoDir uses session file base name", () => {
    const result = getRepoDir("/path/to/session-abc.jsonl");
    expect(result).toContain("session-abc");
  });

  test("getRepoDir falls back to ephemeral when no session file", () => {
    const result = getRepoDir(undefined);
    expect(result).toContain("ephemeral");
  });

  test("getGitDir appends .git to repo dir", () => {
    expect(getGitDir("/repo")).toBe(path.join("/repo", ".git"));
  });

  test("getIndexPath appends index to repo dir", () => {
    expect(getIndexPath("/repo")).toBe(path.join("/repo", "index"));
  });
});
