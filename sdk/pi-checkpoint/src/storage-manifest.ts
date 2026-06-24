import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getStringField, isRecord } from "@ayulab/runtime-core";
import { getCheckpointSessionsRoot, getRepoDir } from "./resolver";

const STORAGE_COMPONENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM"]);

export interface CheckpointStorageManifest {
  readonly version: 1;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly cwd: string;
  readonly firstUserMessage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CheckpointStorageManifestRecord {
  readonly repoDir: string;
  readonly modifiedAt: string;
  readonly manifest: CheckpointStorageManifest;
}

export type DeleteSessionCheckpointStorageResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "path-safety-failed"
        | "manifest-missing"
        | "storage-corrupt"
        | "active-session";
      readonly message: string;
    };

interface ValidatedCheckpointStoragePath {
  readonly ok: true;
  readonly resolvedRepoDir: string;
}

function validateCheckpointStoragePath(
  repoDir: string,
  activeSessionFile: string | undefined,
): DeleteSessionCheckpointStorageResult | ValidatedCheckpointStoragePath {
  const storageRoot = path.resolve(getCheckpointSessionsRoot());
  const resolvedRepoDir = path.resolve(repoDir);
  const storageName = path.basename(resolvedRepoDir);

  if (
    !isSafeStorageComponent(storageName) ||
    path.dirname(resolvedRepoDir) !== storageRoot ||
    path.relative(storageRoot, resolvedRepoDir) !== storageName
  ) {
    return {
      ok: false,
      reason: "path-safety-failed",
      message: "Checkpoint storage path failed safety validation.",
    };
  }

  if (activeSessionFile && path.resolve(getRepoDir(activeSessionFile)) === resolvedRepoDir) {
    return {
      ok: false,
      reason: "active-session",
      message: "The current session's checkpoint storage cannot be deleted.",
    };
  }

  return { ok: true, resolvedRepoDir };
}

function getManifestPath(repoDir: string): string {
  return path.join(repoDir, "manifest.json");
}

function isBusyRenameError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && WINDOWS_RENAME_RETRY_CODES.has(String(error.code));
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === "ENOENT";
}

function isSafeStorageComponent(name: string): boolean {
  return STORAGE_COMPONENT_PATTERN.test(name);
}

function isCheckpointStorageManifest(value: unknown): value is CheckpointStorageManifest {
  return (
    isRecord(value) &&
    value.version === 1 &&
    getStringField(value, "sessionId") !== undefined &&
    getStringField(value, "sessionFile") !== undefined &&
    getStringField(value, "cwd") !== undefined &&
    getStringField(value, "firstUserMessage") !== undefined &&
    getStringField(value, "createdAt") !== undefined &&
    getStringField(value, "updatedAt") !== undefined
  );
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isBusyRenameError(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function readCheckpointStorageManifest(
  repoDir: string,
): Promise<CheckpointStorageManifest | undefined> {
  try {
    const raw = await fs.readFile(getManifestPath(repoDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isCheckpointStorageManifest(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCheckpointStorageManifest(
  repoDir: string,
  manifest: CheckpointStorageManifest,
): Promise<void> {
  const manifestPath = getManifestPath(repoDir);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });

  const tempPath = path.join(
    path.dirname(manifestPath),
    `${path.basename(manifestPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  try {
    await renameWithRetry(tempPath, manifestPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function listCheckpointStorageManifests(): Promise<
  readonly CheckpointStorageManifestRecord[]
> {
  const root = getCheckpointSessionsRoot();
  let entries: readonly Dirent[] = [];

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const manifests: CheckpointStorageManifestRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeStorageComponent(entry.name)) continue;

    const repoDir = path.join(root, entry.name);
    const manifest = await readCheckpointStorageManifest(repoDir);
    if (!manifest) continue;

    const modifiedAt = await fs
      .stat(repoDir)
      .then((stats) => stats.mtime.toISOString())
      .catch(() => manifest.updatedAt);

    manifests.push({ repoDir, modifiedAt, manifest });
  }

  manifests.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return manifests;
}

export async function deleteSessionCheckpointStorage(
  repoDir: string,
  activeSessionFile: string | undefined,
): Promise<DeleteSessionCheckpointStorageResult> {
  const validation = validateCheckpointStoragePath(repoDir, activeSessionFile);
  if (!validation.ok || !("resolvedRepoDir" in validation)) return validation;

  const { resolvedRepoDir } = validation;
  const manifest = await readCheckpointStorageManifest(resolvedRepoDir);
  if (!manifest) {
    return {
      ok: false,
      reason: "manifest-missing",
      message: "Checkpoint storage manifest is missing.",
    };
  }

  const gitDir = path.join(resolvedRepoDir, ".git");
  const hasGitDir = await fs
    .access(gitDir)
    .then(() => true)
    .catch(() => false);
  if (!hasGitDir) {
    return {
      ok: false,
      reason: "storage-corrupt",
      message: "Checkpoint storage is missing its bare git repository.",
    };
  }

  try {
    await fs.rm(resolvedRepoDir, { recursive: true, force: false });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  return { ok: true };
}

export async function purgeSessionCheckpointStorage(
  repoDir: string,
  activeSessionFile: string | undefined,
): Promise<DeleteSessionCheckpointStorageResult> {
  const validation = validateCheckpointStoragePath(repoDir, activeSessionFile);
  if (!validation.ok || !("resolvedRepoDir" in validation)) return validation;

  await fs.rm(validation.resolvedRepoDir, { recursive: true, force: true });
  return { ok: true };
}
