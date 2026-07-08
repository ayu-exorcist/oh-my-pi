import { execFileSync } from "node:child_process";

/**
 * Detect whether files under `paths` changed since `ref` or remain dirty in the
 * current worktree.
 */
export function hasPathChangesSinceRef(
  root: string,
  ref: string,
  paths: readonly string[],
): boolean {
  const scopedArgs = paths.length > 0 ? ["--", ...paths] : [];

  try {
    const committed = execFileSync("git", ["diff", "--name-only", `${ref}..HEAD`, ...scopedArgs], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (committed.trim().length > 0) return true;
  } catch {
    // If the ref does not exist or the diff fails, fall back to a dirty check.
  }

  try {
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", ...scopedArgs],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return dirty.trim().length > 0;
  } catch {
    return true;
  }
}
