import { posix } from "node:path";
import { describe, expect, test, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import {
  getPathBearingToolPath,
  isPathOutsideWorkingDirectory,
  isPathWithinDirectory,
  isPiInfrastructureRead,
  isSafeSystemPath,
  normalizePathForComparison,
  PATH_BEARING_TOOLS,
  READ_ONLY_PATH_BEARING_TOOLS,
  SAFE_SYSTEM_PATHS,
} from "#src/path-utils";

describe("normalizePathForComparison", () => {
  const cwd = "/projects/my-app";

  test("resolves absolute path unchanged", () => {
    expect(normalizePathForComparison("/usr/local/bin", cwd)).toBe("/usr/local/bin");
  });

  test("resolves relative path against cwd", () => {
    expect(normalizePathForComparison("src/foo.ts", cwd)).toBe("/projects/my-app/src/foo.ts");
  });

  test("uses POSIX normalization when the path itself is POSIX-style", () => {
    expect(normalizePathForComparison("/opt/../usr/bin", "C:\\repo")).toBe("/usr/bin");
  });

  test("expands bare ~ to homedir", () => {
    expect(normalizePathForComparison("~", cwd)).toBe("/mock/home");
  });

  test("expands ~/... to homedir-relative path", () => {
    expect(normalizePathForComparison("~/docs/readme.md", cwd)).toBe(
      posix.join("/mock/home", "docs/readme.md"),
    );
  });

  test("strips leading @ before resolving", () => {
    expect(normalizePathForComparison("@/usr/local/bin", cwd)).toBe("/usr/local/bin");
  });

  test("strips surrounding quotes", () => {
    expect(normalizePathForComparison("'/usr/local/bin'", cwd)).toBe("/usr/local/bin");
    expect(normalizePathForComparison('"/usr/local/bin"', cwd)).toBe("/usr/local/bin");
  });

  test("returns empty string for blank/whitespace-only path", () => {
    expect(normalizePathForComparison("", cwd)).toBe("");
    expect(normalizePathForComparison("   ", cwd)).toBe("");
  });
});

describe("isPathWithinDirectory", () => {
  test("returns true when path equals directory", () => {
    expect(isPathWithinDirectory("/a/b", "/a/b")).toBe(true);
  });

  test("returns true when path is a direct child", () => {
    expect(isPathWithinDirectory("/a/b/c", "/a/b")).toBe(true);
    expect(isPathWithinDirectory("/a/b/c", "/a/b/")).toBe(true);
  });

  test("returns true when path is a deep descendant", () => {
    expect(isPathWithinDirectory("/a/b/c/d/e", "/a/b")).toBe(true);
  });

  test("returns false when path is a sibling directory", () => {
    expect(isPathWithinDirectory("/a/bc", "/a/b")).toBe(false);
  });

  test("returns false when path is outside the directory", () => {
    expect(isPathWithinDirectory("/other/path", "/a/b")).toBe(false);
  });

  test("returns false for empty path", () => {
    expect(isPathWithinDirectory("", "/a/b")).toBe(false);
  });

  test("returns false for empty directory", () => {
    expect(isPathWithinDirectory("/a/b", "")).toBe(false);
  });
});

describe("PATH_BEARING_TOOLS", () => {
  test("contains the expected tool names", () => {
    for (const tool of ["read", "write", "edit", "find", "grep", "ls"]) {
      expect(PATH_BEARING_TOOLS.has(tool)).toBe(true);
    }
  });

  test("does not contain bash or mcp", () => {
    expect(PATH_BEARING_TOOLS.has("bash")).toBe(false);
    expect(PATH_BEARING_TOOLS.has("mcp")).toBe(false);
  });
});

describe("READ_ONLY_PATH_BEARING_TOOLS", () => {
  test("contains read, find, grep, ls", () => {
    for (const tool of ["read", "find", "grep", "ls"]) {
      expect(READ_ONLY_PATH_BEARING_TOOLS.has(tool)).toBe(true);
    }
  });

  test("does not contain write or edit", () => {
    expect(READ_ONLY_PATH_BEARING_TOOLS.has("write")).toBe(false);
    expect(READ_ONLY_PATH_BEARING_TOOLS.has("edit")).toBe(false);
  });
});

describe("SAFE_SYSTEM_PATHS", () => {
  test("contains /dev/null, /dev/stdin, /dev/stdout, /dev/stderr", () => {
    expect(SAFE_SYSTEM_PATHS.has("/dev/null")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stdin")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stdout")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stderr")).toBe(true);
  });
});

describe("isSafeSystemPath", () => {
  test("returns true for /dev/null", () => {
    expect(isSafeSystemPath("/dev/null")).toBe(true);
  });

  test("returns true for /dev/stdin", () => {
    expect(isSafeSystemPath("/dev/stdin")).toBe(true);
  });

  test("returns true for /dev/stdout", () => {
    expect(isSafeSystemPath("/dev/stdout")).toBe(true);
  });

  test("returns true for /dev/stderr", () => {
    expect(isSafeSystemPath("/dev/stderr")).toBe(true);
  });

  test("returns false for an arbitrary absolute path", () => {
    expect(isSafeSystemPath("/etc/passwd")).toBe(false);
  });

  test("returns false for a path prefixed with a safe system path", () => {
    expect(isSafeSystemPath("/dev/null/subdir")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isSafeSystemPath("")).toBe(false);
  });

  test("returns false for a relative path", () => {
    expect(isSafeSystemPath("dev/null")).toBe(false);
  });
});

describe("getPathBearingToolPath", () => {
  test("returns path for a path-bearing tool", () => {
    expect(getPathBearingToolPath("read", { path: "/src/foo.ts" })).toBe("/src/foo.ts");
  });

  test("returns null for a non-path-bearing tool", () => {
    expect(getPathBearingToolPath("bash", { path: "/src/foo.ts" })).toBeNull();
    expect(getPathBearingToolPath("mcp", { path: "/src/foo.ts" })).toBeNull();
    expect(getPathBearingToolPath("task", { path: "/src/foo.ts" })).toBeNull();
  });

  test("returns null when input has no path", () => {
    expect(getPathBearingToolPath("read", {})).toBeNull();
    expect(getPathBearingToolPath("read", { path: "" })).toBeNull();
    expect(getPathBearingToolPath("read", null)).toBeNull();
  });
});

describe("isPathOutsideWorkingDirectory", () => {
  const cwd = "/projects/my-app";

  test("returns false when path is inside cwd", () => {
    expect(isPathOutsideWorkingDirectory("/projects/my-app/src", cwd)).toBe(false);
  });

  test("returns false when path equals cwd", () => {
    expect(isPathOutsideWorkingDirectory("/projects/my-app", cwd)).toBe(false);
  });

  test("returns true when path is outside cwd", () => {
    expect(isPathOutsideWorkingDirectory("/etc/passwd", cwd)).toBe(true);
  });

  test("returns true for home directory when outside cwd", () => {
    expect(isPathOutsideWorkingDirectory("~/secrets", cwd)).toBe(true);
  });

  test("returns false for relative path resolving inside cwd", () => {
    expect(isPathOutsideWorkingDirectory("src/index.ts", cwd)).toBe(false);
  });

  test("returns false for empty path (normalizes to empty string)", () => {
    expect(isPathOutsideWorkingDirectory("", cwd)).toBe(false);
  });

  test("returns false for /dev/null regardless of cwd", () => {
    expect(isPathOutsideWorkingDirectory("/dev/null", cwd)).toBe(false);
  });

  test("returns false for /dev/stdin regardless of cwd", () => {
    expect(isPathOutsideWorkingDirectory("/dev/stdin", cwd)).toBe(false);
  });

  test("returns false for /dev/stdout regardless of cwd", () => {
    expect(isPathOutsideWorkingDirectory("/dev/stdout", cwd)).toBe(false);
  });

  test("returns false for /dev/stderr regardless of cwd", () => {
    expect(isPathOutsideWorkingDirectory("/dev/stderr", cwd)).toBe(false);
  });

  test("returns true for /dev/null/subdir (not a safe path)", () => {
    expect(isPathOutsideWorkingDirectory("/dev/null/subdir", cwd)).toBe(true);
  });
});

describe("isPiInfrastructureRead", () => {
  const cwd = "/projects/my-app";
  const infraDirs = ["/mock/home/.pi/agent"];

  test("returns true for read-only tool reading from infra dir", () => {
    expect(isPiInfrastructureRead("read", "/mock/home/.pi/agent/config.json", infraDirs, cwd)).toBe(
      true,
    );
  });

  test("returns false for write tool even in infra dir", () => {
    expect(
      isPiInfrastructureRead("write", "/mock/home/.pi/agent/config.json", infraDirs, cwd),
    ).toBe(false);
  });

  test("returns true for read-only tool reading from project .pi/npm", () => {
    expect(isPiInfrastructureRead("read", "/projects/my-app/.pi/npm/package.json", [], cwd)).toBe(
      true,
    );
  });

  test("returns true for read-only tool reading from project .pi/git", () => {
    expect(isPiInfrastructureRead("grep", "/projects/my-app/.pi/git/some-file", [], cwd)).toBe(
      true,
    );
  });

  test("returns false for path outside all infra dirs and project dirs", () => {
    expect(isPiInfrastructureRead("read", "/etc/passwd", infraDirs, cwd)).toBe(false);
  });

  // ── glob patterns ─────────────────────────────────────────────────

  test("glob entry matches a versioned path", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/opt/homebrew/Cellar/pi-coding-agent/0.74.0/libexec/lib/node_modules/@earendil-works/pi-coding-agent/SKILL.md",
        ["/opt/homebrew/**/@earendil-works/pi-coding-agent/**"],
        cwd,
      ),
    ).toBe(true);
  });

  test("glob entry does not match an unrelated path", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/etc/passwd",
        ["/opt/homebrew/**/@earendil-works/pi-coding-agent/**"],
        cwd,
      ),
    ).toBe(false);
  });

  test("plain entry with ~ expands to home dir for matching", () => {
    // node:os is mocked: homedir() returns "/mock/home"
    expect(
      isPiInfrastructureRead("read", "/mock/home/.pi/agent/config.json", ["~/.pi/agent"], cwd),
    ).toBe(true);
  });
});
