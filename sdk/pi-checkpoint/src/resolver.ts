import path from "node:path";
import os from "node:os";

/** Root directory for all session checkpoint repos. */
function baseDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "ayu", "checkpoints", "sessions");
}

/**
 * Resolve the checkpoint repo directory for a given session file.
 *
 * @param sessionFile - Absolute path to the session `.jsonl` file.
 * @returns Directory where the bare repo and index should live.
 */
export function getRepoDir(sessionFile: string | undefined): string {
  if (!sessionFile) {
    return path.join(baseDir(), "ephemeral");
  }
  const base = path.basename(sessionFile, ".jsonl");
  return path.join(baseDir(), base);
}

/** Resolve the bare `.git` directory inside a repo dir. */
export function getGitDir(repoDir: string): string {
  return path.join(repoDir, ".git");
}

/** Resolve the external git index file path (kept outside the work tree). */
export function getIndexPath(repoDir: string): string {
  return path.join(repoDir, "index");
}
