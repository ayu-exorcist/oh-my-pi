import { homedir } from "node:os";
import { join, normalize, posix, resolve } from "node:path";

import { getNonEmptyString, toRecord } from "./common";
import { joinPathLike } from "./config-paths";
import { expandHomePath } from "./expand-home";
import { wildcardMatch } from "./wildcard-matcher";

function usesPosixPathStyle(pathValue: string): boolean {
  return pathValue.startsWith("/") && !/^[A-Za-z]:/.test(pathValue);
}

function toComparablePath(pathValue: string): string {
  const normalizedPath = pathValue.replace(/\\/g, "/");
  return process.platform === "win32" && /^[A-Za-z]:/.test(normalizedPath)
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

export function normalizePathForComparison(pathValue: string, cwd: string): string {
  const trimmed = pathValue.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return "";
  }

  let normalizedPath = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const shouldUsePosix = usesPosixPathStyle(cwd) || usesPosixPathStyle(normalizedPath);

  if (normalizedPath === "~") {
    normalizedPath = homedir();
  } else if (normalizedPath.startsWith("~/") || normalizedPath.startsWith("~\\")) {
    normalizedPath = shouldUsePosix
      ? posix.join(homedir(), normalizedPath.slice(2))
      : join(homedir(), normalizedPath.slice(2));
  }

  const absolutePath = shouldUsePosix
    ? posix.resolve(cwd, normalizedPath.replace(/\\/g, "/"))
    : resolve(cwd, normalizedPath);
  const normalizedAbsolutePath = shouldUsePosix
    ? posix.normalize(absolutePath)
    : normalize(absolutePath);
  return toComparablePath(normalizedAbsolutePath);
}

export function isPathWithinDirectory(pathValue: string, directory: string): boolean {
  if (!pathValue || !directory) {
    return false;
  }

  const normalizedPath = toComparablePath(pathValue);
  const normalizedDirectory = toComparablePath(directory);

  if (normalizedPath === normalizedDirectory) {
    return true;
  }

  const prefix = normalizedDirectory.endsWith("/")
    ? normalizedDirectory
    : `${normalizedDirectory}/`;
  return normalizedPath.startsWith(prefix);
}

/**
 * Paths that are universally safe and should never trigger external-directory checks.
 * These are OS device files: read returns EOF or process streams, write discards or goes to process streams.
 */
export const SAFE_SYSTEM_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

/**
 * Returns true if the given normalized path is a safe OS device file
 * that should never trigger external-directory checks.
 */
export function isSafeSystemPath(normalizedPath: string): boolean {
  return SAFE_SYSTEM_PATHS.has(normalizedPath);
}

/**
 * File tools that only read — never write — the filesystem.
 * Only these tools are eligible for the Pi infrastructure auto-allow.
 */
export const READ_ONLY_PATH_BEARING_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "find",
  "grep",
  "ls",
]);

export const PATH_BEARING_TOOLS = new Set(["read", "write", "edit", "find", "grep", "ls"]);

export function getPathBearingToolPath(toolName: string, input: unknown): string | null {
  if (!PATH_BEARING_TOOLS.has(toolName)) {
    return null;
  }

  return getNonEmptyString(toRecord(input).path);
}

export function isPathOutsideWorkingDirectory(pathValue: string, cwd: string): boolean {
  const normalizedCwd = normalizePathForComparison(cwd, cwd);
  const normalizedPath = normalizePathForComparison(pathValue, cwd);
  if (!normalizedCwd || !normalizedPath) {
    return false;
  }
  if (isSafeSystemPath(toComparablePath(normalizedPath))) {
    return false;
  }
  return !isPathWithinDirectory(normalizedPath, normalizedCwd);
}

function containsGlobChars(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

/**
 * Returns true if the given tool + normalized path combination qualifies for
 * automatic allow as a Pi infrastructure read.
 *
 * A path qualifies when:
 * 1. The tool is read-only (in READ_ONLY_PATH_BEARING_TOOLS).
 * 2. The normalized path is within one of the provided `infrastructureDirs`
 *    OR within the project-local Pi package directories
 *    (`<cwd>/.pi/npm/` or `<cwd>/.pi/git/`).
 *
 * `infrastructureDirs` entries may be absolute paths or patterns containing
 * `~`/`$HOME` (expanded at call time) or glob characters (`*`, `?`).
 * Project-local paths are computed fresh from `cwd` on each call so they
 * follow working-directory changes without a runtime rebuild.
 */
export function isPiInfrastructureRead(
  toolName: string,
  normalizedPath: string,
  infrastructureDirs: readonly string[],
  cwd: string,
): boolean {
  if (!READ_ONLY_PATH_BEARING_TOOLS.has(toolName)) {
    return false;
  }

  const comparablePath = toComparablePath(normalizedPath);

  for (const dir of infrastructureDirs) {
    const expandedDir = expandHomePath(dir);
    if (containsGlobChars(expandedDir)) {
      if (wildcardMatch(toComparablePath(expandedDir), comparablePath)) return true;
    } else {
      if (isPathWithinDirectory(comparablePath, expandedDir)) return true;
    }
  }

  // Project-local Pi packages — checked fresh every call so CWD changes work.
  const projectNpmDir = joinPathLike(cwd, ".pi", "npm");
  const projectGitDir = joinPathLike(cwd, ".pi", "git");
  if (isPathWithinDirectory(normalizedPath, projectNpmDir)) {
    return true;
  }
  if (isPathWithinDirectory(normalizedPath, projectGitDir)) {
    return true;
  }

  return false;
}
