import { execSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import {
  commit,
  createRelease,
  createReleases,
  createTag,
  createTags,
  hasCommittedPathChangesSinceRef,
  hasPathChangesSinceRef,
  hasRef,
  pushCurrentBranch,
  pushTag,
  pushTags,
  stagePaths,
  tagAndRelease,
} from "./git";

const mockExecSync = vi.mocked(execSync);

describe("git helpers", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("checks whether refs exist", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("ok"));
    expect(hasRef("/repo", "HEAD")).toBe(true);

    mockExecSync.mockImplementationOnce(() => {
      throw new Error("missing");
    });
    expect(hasRef("/repo", "missing")).toBe(false);
  });

  test("detects committed, dirty, and unknown path changes", () => {
    mockExecSync.mockReturnValueOnce("changed.ts\n" as never);
    expect(hasCommittedPathChangesSinceRef("/repo", "tag", ["src", 'quote"path'])).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff --name-only tag..HEAD -- "src" "quote\\"path"',
      { cwd: "/repo", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );

    mockExecSync.mockReset();
    mockExecSync.mockReturnValueOnce("\n" as never);
    expect(hasCommittedPathChangesSinceRef("/repo", "tag", [])).toBe(false);

    mockExecSync.mockReset();
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("bad ref");
    });
    expect(hasCommittedPathChangesSinceRef("/repo", "tag", ["src"])).toBe(true);

    mockExecSync.mockReset();
    mockExecSync.mockReturnValueOnce("changed.ts\n" as never);
    expect(hasPathChangesSinceRef("/repo", "tag", ["src"])).toBe(true);

    mockExecSync.mockReset();
    mockExecSync.mockReturnValueOnce("\n" as never).mockReturnValueOnce("?? file\n" as never);
    expect(hasPathChangesSinceRef("/repo", "tag", [])).toBe(true);

    mockExecSync.mockReset();
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("bad ref");
      })
      .mockReturnValueOnce("\n" as never);
    expect(hasPathChangesSinceRef("/repo", "tag", ["src"])).toBe(false);

    mockExecSync.mockReset();
    mockExecSync.mockReturnValueOnce("\n" as never).mockImplementationOnce(() => {
      throw new Error("status failed");
    });
    expect(hasPathChangesSinceRef("/repo", "tag", ["src"])).toBe(true);
  });

  test("stages, commits, and pushes current branch", () => {
    stagePaths("/repo", []);
    expect(mockExecSync).not.toHaveBeenCalled();

    stagePaths("/repo", ["a.ts", 'b".ts']);
    commit("/repo", 'release "pkg"');
    pushCurrentBranch("/repo");

    expect(mockExecSync).toHaveBeenNthCalledWith(1, 'git add -A -- "a.ts" "b\\".ts"', {
      cwd: "/repo",
      stdio: "pipe",
    });
    expect(mockExecSync).toHaveBeenNthCalledWith(2, 'git commit -m "release \\"pkg\\""', {
      cwd: "/repo",
      stdio: "pipe",
    });
    expect(mockExecSync).toHaveBeenNthCalledWith(3, "git push origin HEAD", {
      cwd: "/repo",
      stdio: "pipe",
    });
  });

  test("creates, skips, and handles failed tags", () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("missing tag");
      })
      .mockReturnValueOnce(Buffer.from("created"));
    expect(createTag("/repo", "pkg", "1.0.0")).toBe("pkg@1.0.0");

    mockExecSync.mockReset();
    mockExecSync.mockReturnValueOnce(Buffer.from("exists"));
    expect(createTag("/repo", "pkg", "1.0.0")).toBeNull();

    mockExecSync.mockReset();
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("missing tag");
      })
      .mockImplementationOnce(() => {
        throw new Error("cannot tag");
      });
    expect(createTag("/repo", "pkg", "1.0.0")).toBeNull();
  });

  test("pushes tags and releases while tolerating failures", () => {
    pushTag("/repo", "pkg@1.0.0");
    createRelease("/repo", "pkg@1.0.0");
    pushTags("/repo", []);
    expect(mockExecSync).toHaveBeenCalledTimes(2);

    mockExecSync.mockImplementation(() => {
      throw new Error("remote failed");
    });
    pushTag("/repo", "pkg@1.0.0");
    createRelease("/repo", "pkg@1.0.0");
    pushTags("/repo", ["a@1.0.0", "b@1.0.0"]);
    expect(console.warn).toHaveBeenCalled();
  });

  test("runs tag and release pipeline and batch helpers", () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("missing tag");
      })
      .mockReturnValueOnce(Buffer.from("created"));
    tagAndRelease("/repo", "pkg", "1.0.0");
    expect(mockExecSync).toHaveBeenCalledWith("git push origin pkg@1.0.0", {
      cwd: "/repo",
      stdio: "pipe",
    });

    mockExecSync.mockReset();
    mockExecSync.mockReturnValue(Buffer.from("exists"));
    tagAndRelease("/repo", "pkg", "1.0.0");
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    mockExecSync.mockReset();
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("missing tag");
      })
      .mockImplementationOnce(() => {
        throw new Error("tag create failed");
      });
    expect(createTags("/repo", new Map([["a", "1.0.0"]]))).toEqual([]);

    mockExecSync.mockReset();
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("missing tag");
      })
      .mockReturnValueOnce(Buffer.from("created"));
    expect(createTags("/repo", new Map([["a", "1.0.0"]]))).toEqual(["a@1.0.0"]);

    mockExecSync.mockReset();
    createReleases("/repo", ["a@1.0.0", "b@1.0.0"]);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  test("skips pushing tags when the batch is empty", () => {
    pushTags("/repo", []);
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
