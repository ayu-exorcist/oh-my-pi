import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withRepoLock } from "./lock";

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pi-lock-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("withRepoLock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await cleanup(tmpDir);
  });

  test("executes fn and returns its result", async () => {
    const result = await withRepoLock(tmpDir, async () => "hello");
    expect(result).toBe("hello");
  });

  test("creates and removes lock directory", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");

    await withRepoLock(tmpDir, async () => {
      const exists = await fs
        .access(lockPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    const gone = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(gone).toBe(false);
  });

  test("ignores heartbeat touch failures while preserving the held lock", async () => {
    vi.useFakeTimers();
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    const utimesSpy = vi.spyOn(fs, "utimes").mockRejectedValueOnce(new Error("touch failed"));
    let releaseLock: () => void = () => {};

    const enteredLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locked = withRepoLock(tmpDir, async () => {
      releaseLock();
      await new Promise<void>((release) => {
        releaseLock = release;
      });
      return "released";
    });

    await enteredLock;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(utimesSpy).toHaveBeenCalledWith(lockPath, expect.any(Date), expect.any(Date));
    const exists = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    releaseLock();
    await expect(locked).resolves.toBe("released");
  });

  test("serialises concurrent callers on the same repo", async () => {
    const order: number[] = [];

    const p1 = withRepoLock(tmpDir, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return "a";
    });

    // Ensure p1 acquires the lock before p2 starts competing.
    await new Promise((r) => setTimeout(r, 10));

    const p2 = withRepoLock(tmpDir, async () => {
      order.push(3);
      return "b";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(order).toEqual([1, 2, 3]);
  });

  test("allows concurrent access to different repos", async () => {
    const dir2 = await createTmpDir();
    try {
      let inside1 = false;
      let inside2 = false;

      const p1 = withRepoLock(tmpDir, async () => {
        inside1 = true;
        await new Promise((r) => setTimeout(r, 50));
        expect(inside2).toBe(true);
        return "a";
      });

      const p2 = withRepoLock(dir2, async () => {
        inside2 = true;
        await new Promise((r) => setTimeout(r, 50));
        expect(inside1).toBe(true);
        return "b";
      });

      await Promise.all([p1, p2]);
    } finally {
      await cleanup(dir2);
    }
  });

  test("removes lock even when fn throws", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");

    await expect(
      withRepoLock(tmpDir, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const gone = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(gone).toBe(false);
  });

  test("breaks stale locks older than 30s", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.mkdir(lockPath);

    // Backdate the lock directory by touching it into the past.
    const past = new Date(Date.now() - 40_000);
    await fs.utimes(lockPath, past, past);

    const result = await withRepoLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");

    const gone = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(gone).toBe(false);
  });

  test("breaks stale lock files", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.writeFile(lockPath, "not a directory", "utf8");

    const past = new Date(Date.now() - 40_000);
    await fs.utimes(lockPath, past, past);

    const result = await withRepoLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");

    const gone = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(gone).toBe(false);
  });

  test("breaks stale non-empty lock directories", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner"), "stale", "utf8");

    const past = new Date(Date.now() - 40_000);
    await fs.utimes(path.join(lockPath, "owner"), past, past);
    await fs.utimes(lockPath, past, past);

    const result = await withRepoLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");

    const gone = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(gone).toBe(false);
  });

  test("throws when stale lock cleanup fails", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.mkdir(lockPath);

    const past = new Date(Date.now() - 40_000);
    await fs.utimes(lockPath, past, past);

    const rmSpy = vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("busy"));

    await expect(withRepoLock(tmpDir, async () => "ok")).rejects.toThrow("busy");

    rmSpy.mockRestore();
  });

  test("times out when active lock remains held", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.mkdir(lockPath);

    await expect(withRepoLock(tmpDir, async () => "ok", { acquireTimeoutMs: 10 })).rejects.toThrow(
      `Timed out after 10ms waiting for checkpoint lock at ${lockPath}`,
    );
  });

  test("waits for active lock when not stale", async () => {
    const order: number[] = [];

    const p1 = withRepoLock(tmpDir, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 100));
      order.push(2);
      return "first";
    });

    // Slight delay so p1 acquires first.
    await new Promise((r) => setTimeout(r, 10));

    const p2 = withRepoLock(tmpDir, async () => {
      order.push(3);
      return "second";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(order).toEqual([1, 2, 3]);
  });

  test("retries immediately when lock vanishes between mkdir and stat", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.mkdir(lockPath);

    const statSpy = vi.spyOn(fs, "stat").mockImplementation(async () => {
      await fs.rmdir(lockPath).catch(() => {});
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    const result = await withRepoLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");

    statSpy.mockRestore();
  });

  test("propagates unexpected stat errors while inspecting an existing lock", async () => {
    const lockPath = path.join(tmpDir, ".pi-checkpoint-lock");
    await fs.mkdir(lockPath);
    const err = new Error("EACCES") as NodeJS.ErrnoException;
    err.code = "EACCES";
    const statSpy = vi.spyOn(fs, "stat").mockRejectedValueOnce(err);

    await expect(withRepoLock(tmpDir, async () => "ok")).rejects.toThrow("EACCES");
    expect(statSpy).toHaveBeenCalledWith(lockPath);
  });

  test("throws when mkdir fails with an unexpected error", async () => {
    const mkdirSpy = vi.spyOn(fs, "mkdir").mockImplementation(async () => {
      const err = new Error("EINVAL") as NodeJS.ErrnoException;
      err.code = "EINVAL";
      throw err;
    });

    await expect(withRepoLock(tmpDir, async () => "ok")).rejects.toThrow("EINVAL");

    mkdirSpy.mockRestore();
  });

  test("ignores rmdir failure in finally block", async () => {
    const rmdirSpy = vi.spyOn(fs, "rmdir").mockRejectedValue(new Error("busy"));

    const result = await withRepoLock(tmpDir, async () => "ok");
    expect(result).toBe("ok");

    rmdirSpy.mockRestore();
  });
});
