import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { hasPathChangesSinceRef } from "./git";

const mockExecFileSync = vi.mocked(execFileSync);

describe("git helpers", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  test("detects committed path changes", () => {
    mockExecFileSync.mockReturnValueOnce("changed.ts\n" as never);

    expect(hasPathChangesSinceRef("/repo", "tag", ["src", 'quote"path'])).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "tag..HEAD", "--", "src", 'quote"path'],
      { cwd: "/repo", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  });

  test("falls back to dirty status when committed diff is empty", () => {
    mockExecFileSync.mockReturnValueOnce("\n" as never).mockReturnValueOnce("?? file\n" as never);

    expect(hasPathChangesSinceRef("/repo", "tag", [])).toBe(true);
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      {
        cwd: "/repo",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  });

  test("returns false when committed and dirty checks are empty", () => {
    mockExecFileSync.mockReturnValueOnce("\n" as never).mockReturnValueOnce("\n" as never);

    expect(hasPathChangesSinceRef("/repo", "tag", ["src"])).toBe(false);
  });

  test("falls back to dirty status when the ref diff fails", () => {
    mockExecFileSync
      .mockImplementationOnce(() => {
        throw new Error("bad ref");
      })
      .mockReturnValueOnce("\n" as never);

    expect(hasPathChangesSinceRef("/repo", "tag", ["src"])).toBe(false);
  });

  test("treats status failures as changed", () => {
    mockExecFileSync.mockReturnValueOnce("\n" as never).mockImplementationOnce(() => {
      throw new Error("status failed");
    });

    expect(hasPathChangesSinceRef("/repo", "tag", ["src"])).toBe(true);
  });
});
