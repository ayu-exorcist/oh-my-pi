import { execSync } from "node:child_process";

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function pathArgs(paths: readonly string[]): string {
  return paths.length > 0 ? ` -- ${paths.map(quote).join(" ")}` : "";
}

/**
 * Detect whether files under `paths` changed since `ref` or remain dirty in the
 * current worktree.
 */
export function hasPathChangesSinceRef(
  root: string,
  ref: string,
  paths: readonly string[],
): boolean {
  const scoped = pathArgs(paths);

  try {
    const committed = execSync(`git diff --name-only ${ref}..HEAD${scoped}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (committed.trim().length > 0) return true;
  } catch {
    // If the ref does not exist or the diff fails, fall back to a dirty check.
  }

  try {
    const dirty = execSync(`git status --porcelain --untracked-files=all${scoped}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return dirty.trim().length > 0;
  } catch {
    return true;
  }
}
