import fs from "node:fs/promises";
import path from "node:path";

const LOCK_DIR_NAME = ".pi-checkpoint-lock";

/** Narrow `unknown` to a Node.js error with a `code` property. */
function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
const STALE_MS = 30_000;
const POLL_INTERVAL_MS = 50;

/**
 * Acquire an exclusive filesystem lock on a repo directory.
 *
 * Uses `mkdir` for atomic lock creation. If the lock is stale (older than
 * 30s), it is broken automatically to recover from crashed processes.
 */
async function acquire(lockPath: string): Promise<void> {
  while (true) {
    try {
      await fs.mkdir(lockPath);
      return;
    } catch (err) {
      if (!isNodeError(err) || (err.code !== "EEXIST" && err.code !== "EPERM")) throw err;

      try {
        const s = await fs.stat(lockPath);
        if (Date.now() - s.mtimeMs > STALE_MS) {
          await fs.rmdir(lockPath);
          continue;
        }
      } catch {
        // Lock was released between mkdir and stat; retry immediately.
        continue;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

/**
 * Execute `fn` while holding an exclusive filesystem lock on `repoDir`.
 *
 * The lock is released in a `finally` block so crashes inside `fn` do not
 * leak it indefinitely (the stale-detection mechanism handles that edge case).
 */
export async function withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(repoDir, LOCK_DIR_NAME);
  await acquire(lockPath);
  try {
    return await fn();
  } finally {
    await fs.rmdir(lockPath).catch(() => {});
  }
}
