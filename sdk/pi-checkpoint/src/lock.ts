import fs from "node:fs/promises";
import path from "node:path";

const LOCK_DIR_NAME = ".pi-checkpoint-lock";

/** Narrow `unknown` to a Node.js error with a `code` property. */
function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
const STALE_MS = 30_000;
const POLL_INTERVAL_MS = 50;
const LOCK_ACQUIRE_TIMEOUT_MS = 60_000;
const LOCK_HEARTBEAT_MS = 10_000;

export interface RepoLockOptions {
  readonly acquireTimeoutMs?: number;
}

function lockTimeoutMessage(lockPath: string, timeoutMs: number): string {
  return `Timed out after ${timeoutMs}ms waiting for checkpoint lock at ${lockPath}`;
}

/**
 * Acquire an exclusive filesystem lock on a repo directory.
 *
 * Uses `mkdir` for atomic lock creation. If the lock is stale (older than
 * 30s), it is broken automatically to recover from crashed processes.
 */
async function acquire(lockPath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (true) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(lockTimeoutMessage(lockPath, timeoutMs));
    }

    try {
      await fs.mkdir(lockPath);
      return;
    } catch (err) {
      if (!isNodeError(err) || (err.code !== "EEXIST" && err.code !== "EPERM")) throw err;

      let s: Awaited<ReturnType<typeof fs.stat>>;
      try {
        s = await fs.stat(lockPath);
      } catch (statErr) {
        if (isNodeError(statErr) && statErr.code === "ENOENT") {
          // Lock was released between mkdir and stat; retry immediately.
          continue;
        }
        throw statErr;
      }

      if (Date.now() - s.mtimeMs > STALE_MS) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await new Promise((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remainingMs)));
    }
  }
}

/**
 * Execute `fn` while holding an exclusive filesystem lock on `repoDir`.
 *
 * The lock is released in a `finally` block so crashes inside `fn` do not
 * leak it indefinitely (the stale-detection mechanism handles that edge case).
 */
export async function withRepoLock<T>(
  repoDir: string,
  fn: () => Promise<T>,
  options: RepoLockOptions = {},
): Promise<T> {
  const lockPath = path.join(repoDir, LOCK_DIR_NAME);
  await acquire(lockPath, options.acquireTimeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    const now = new Date();
    void fs.utimes(lockPath, now, now).catch(() => {});
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await fs.rmdir(lockPath).catch(() => {});
  }
}
