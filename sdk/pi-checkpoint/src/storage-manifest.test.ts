import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  deleteSessionCheckpointStorage,
  listCheckpointStorageManifests,
  purgeSessionCheckpointStorage,
  readCheckpointStorageManifest,
  writeCheckpointStorageManifest,
  type CheckpointStorageManifest,
} from "./storage-manifest";
import { getCheckpointSessionsRoot, getRepoDir } from "./resolver";

function createManifest(sessionFile: string, cwd: string, suffix = "1"): CheckpointStorageManifest {
  return {
    version: 1,
    sessionId: `session-${suffix}`,
    sessionFile,
    cwd,
    firstUserMessage: `Prompt ${suffix}`,
    createdAt: `2026-06-2${suffix}T00:00:00.000Z`,
    updatedAt: `2026-06-2${suffix}T01:00:00.000Z`,
  };
}

describe("storage manifest", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-storage-manifest-test-"));
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("writes and reads a manifest", async () => {
    const repoDir = path.join(getCheckpointSessionsRoot(), "session-a");
    const manifest = createManifest(path.join(tmpDir, "session-a.jsonl"), tmpDir, "1");

    await writeCheckpointStorageManifest(repoDir, manifest);

    await expect(readCheckpointStorageManifest(repoDir)).resolves.toEqual(manifest);
  });

  test("returns undefined for missing or invalid manifests", async () => {
    const repoDir = path.join(getCheckpointSessionsRoot(), "session-b");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "manifest.json"), "{}", "utf8");

    await expect(
      readCheckpointStorageManifest(path.join(getCheckpointSessionsRoot(), "missing")),
    ).resolves.toBeUndefined();
    await expect(readCheckpointStorageManifest(repoDir)).resolves.toBeUndefined();
  });

  test("retries busy rename when writing a manifest", async () => {
    const repoDir = path.join(getCheckpointSessionsRoot(), "session-c");
    const manifest = createManifest(path.join(tmpDir, "session-c.jsonl"), tmpDir, "2");
    const realRename = fs.rename.bind(fs);
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EPERM" }))
      .mockImplementation(realRename);

    await writeCheckpointStorageManifest(repoDir, manifest);

    expect(rename).toHaveBeenCalledTimes(2);
    await expect(readCheckpointStorageManifest(repoDir)).resolves.toEqual(manifest);
  });

  test("removes the temp file when rename fails", async () => {
    const repoDir = path.join(getCheckpointSessionsRoot(), "session-d");
    const manifest = createManifest(path.join(tmpDir, "session-d.jsonl"), tmpDir, "3");
    vi.spyOn(fs, "rename").mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );

    await expect(writeCheckpointStorageManifest(repoDir, manifest)).rejects.toThrow("denied");

    const files = await fs.readdir(repoDir);
    expect(files).toEqual([]);
  });

  test("ignores temp file cleanup failures after rename errors", async () => {
    const repoDir = path.join(getCheckpointSessionsRoot(), "session-e");
    const manifest = createManifest(path.join(tmpDir, "session-e.jsonl"), tmpDir, "8");
    vi.spyOn(fs, "rename").mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(writeCheckpointStorageManifest(repoDir, manifest)).rejects.toThrow("denied");
  });

  test("lists manifests sorted by modified time and ignores invalid entries", async () => {
    const root = getCheckpointSessionsRoot();
    const repoA = path.join(root, "session-a");
    const repoB = path.join(root, "session-b");
    const repoInvalid = path.join(root, "bad entry");
    const repoBroken = path.join(root, "session-broken");
    await writeCheckpointStorageManifest(
      repoA,
      createManifest(path.join(tmpDir, "session-a.jsonl"), path.join(tmpDir, "a"), "1"),
    );
    await writeCheckpointStorageManifest(
      repoB,
      createManifest(path.join(tmpDir, "session-b.jsonl"), path.join(tmpDir, "b"), "2"),
    );
    await fs.mkdir(repoInvalid, { recursive: true });
    await fs.mkdir(repoBroken, { recursive: true });
    await fs.writeFile(path.join(repoBroken, "manifest.json"), "{}", "utf8");

    const oldTime = new Date("2026-06-20T00:00:00.000Z");
    const realStat = fs.stat.bind(fs);
    await fs.utimes(repoA, oldTime, oldTime);
    vi.spyOn(fs, "stat").mockImplementation(async (targetPath) => {
      if (String(targetPath).endsWith("session-b")) throw new Error("stat failed");
      return realStat(targetPath);
    });

    const manifests = await listCheckpointStorageManifests();
    expect(manifests.map((entry) => path.basename(entry.repoDir))).toEqual([
      "session-b",
      "session-a",
    ]);
    expect(manifests[0]?.modifiedAt).toBe("2026-06-22T01:00:00.000Z");
  });

  test("returns an empty list when the storage root does not exist", async () => {
    await fs.rm(getCheckpointSessionsRoot(), { recursive: true, force: true });
    await expect(listCheckpointStorageManifests()).resolves.toEqual([]);
  });

  test("delete rejects unsafe paths, active session storage, missing manifests, and corrupt repos", async () => {
    const activeSessionFile = path.join(tmpDir, "active.jsonl");
    const activeRepoDir = getRepoDir(activeSessionFile);
    await writeCheckpointStorageManifest(
      activeRepoDir,
      createManifest(activeSessionFile, tmpDir, "4"),
    );
    await fs.mkdir(path.join(activeRepoDir, ".git"), { recursive: true });

    await expect(
      deleteSessionCheckpointStorage(
        path.join(getCheckpointSessionsRoot(), "..", "oops"),
        activeSessionFile,
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "path-safety-failed",
      message: "Checkpoint storage path failed safety validation.",
    });

    await expect(deleteSessionCheckpointStorage(activeRepoDir, activeSessionFile)).resolves.toEqual(
      {
        ok: false,
        reason: "active-session",
        message: "The current session's checkpoint storage cannot be deleted.",
      },
    );

    const manifestMissingRepo = path.join(getCheckpointSessionsRoot(), "missing-manifest");
    await fs.mkdir(manifestMissingRepo, { recursive: true });
    await expect(deleteSessionCheckpointStorage(manifestMissingRepo, undefined)).resolves.toEqual({
      ok: false,
      reason: "manifest-missing",
      message: "Checkpoint storage manifest is missing.",
    });

    const corruptRepo = path.join(getCheckpointSessionsRoot(), "corrupt-repo");
    await writeCheckpointStorageManifest(
      corruptRepo,
      createManifest(path.join(tmpDir, "corrupt.jsonl"), tmpDir, "5"),
    );
    await expect(deleteSessionCheckpointStorage(corruptRepo, undefined)).resolves.toEqual({
      ok: false,
      reason: "storage-corrupt",
      message: "Checkpoint storage is missing its bare git repository.",
    });
  });

  test("purge rejects the current active session storage", async () => {
    const activeSessionFile = path.join(tmpDir, "active-purge.jsonl");
    const activeRepoDir = getRepoDir(activeSessionFile);
    await fs.mkdir(activeRepoDir, { recursive: true });

    await expect(purgeSessionCheckpointStorage(activeRepoDir, activeSessionFile)).resolves.toEqual({
      ok: false,
      reason: "active-session",
      message: "The current session's checkpoint storage cannot be deleted.",
    });
  });

  test("deletes healthy storage and treats already-removed storage as deleted", async () => {
    const repoDir = path.join(getCheckpointSessionsRoot(), "session-delete");
    await writeCheckpointStorageManifest(
      repoDir,
      createManifest(path.join(tmpDir, "delete.jsonl"), tmpDir, "6"),
    );
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });

    await expect(deleteSessionCheckpointStorage(repoDir, undefined)).resolves.toEqual({ ok: true });
    await expect(fs.access(repoDir)).rejects.toBeDefined();

    const raceRepoDir = path.join(getCheckpointSessionsRoot(), "session-delete-race");
    await writeCheckpointStorageManifest(
      raceRepoDir,
      createManifest(path.join(tmpDir, "delete-race.jsonl"), tmpDir, "7"),
    );
    await fs.mkdir(path.join(raceRepoDir, ".git"), { recursive: true });
    const realRm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementationOnce(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    await expect(deleteSessionCheckpointStorage(raceRepoDir, undefined)).resolves.toEqual({
      ok: true,
    });
    await realRm(raceRepoDir, { recursive: true, force: true });

    const orphanRepo = path.join(getCheckpointSessionsRoot(), "session-purge");
    await fs.mkdir(orphanRepo, { recursive: true });
    await fs.writeFile(path.join(orphanRepo, "leftover.txt"), "x", "utf8");

    await expect(purgeSessionCheckpointStorage(orphanRepo, undefined)).resolves.toEqual({
      ok: true,
    });
    await expect(fs.access(orphanRepo)).rejects.toBeDefined();
  });
});
