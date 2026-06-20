import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withRepoLock } from "./lock";

interface WorktreeRegistryEntry {
  readonly worktreeId: string;
  readonly realpath: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

interface WorktreeRegistry {
  readonly worktrees: readonly WorktreeRegistryEntry[];
}

/** Root directory for all checkpoint storage. */
export function getCheckpointRootDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "ayu", "checkpoints");
}

/** Legacy root directory for per-session checkpoint repos. */
export function getLegacySessionsDir(): string {
  return path.join(getCheckpointRootDir(), "sessions");
}

/** Registry path for Worktree Checkpoint Storage. */
export function getWorktreeRegistryPath(): string {
  return path.join(getCheckpointRootDir(), "worktrees.json");
}

/** Stable worktree id derived from the normalized real path. */
export function getWorktreeId(realPath: string): string {
  return crypto.createHash("sha256").update(realPath).digest("hex");
}

async function normalizeWorktreePath(cwd: string): Promise<string> {
  const resolved = path.resolve(cwd);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function readRegistry(registryPath: string): Promise<WorktreeRegistry> {
  try {
    const raw = await fs.readFile(registryPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { worktrees?: unknown }).worktrees)
    ) {
      return { worktrees: [] };
    }

    const worktrees = (parsed as { worktrees: readonly unknown[] }).worktrees.filter(
      (entry): entry is WorktreeRegistryEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as WorktreeRegistryEntry).worktreeId === "string" &&
        typeof (entry as WorktreeRegistryEntry).realpath === "string" &&
        typeof (entry as WorktreeRegistryEntry).displayName === "string" &&
        typeof (entry as WorktreeRegistryEntry).createdAt === "string" &&
        typeof (entry as WorktreeRegistryEntry).lastSeenAt === "string",
    );
    return { worktrees };
  } catch {
    return { worktrees: [] };
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

async function writeRegistryEntry(entry: WorktreeRegistryEntry): Promise<void> {
  const checkpointRoot = getCheckpointRootDir();
  const registryPath = getWorktreeRegistryPath();
  await fs.mkdir(checkpointRoot, { recursive: true });
  await withRepoLock(checkpointRoot, async () => {
    const registry = await readRegistry(registryPath);
    const existing = registry.worktrees.find((item) => item.worktreeId === entry.worktreeId);
    const nextEntry = existing ? { ...existing, ...entry, createdAt: existing.createdAt } : entry;
    const worktrees = [
      ...registry.worktrees.filter((item) => item.worktreeId !== entry.worktreeId),
      nextEntry,
    ].sort((left, right) => left.worktreeId.localeCompare(right.worktreeId));
    await writeJsonAtomic(registryPath, { worktrees });
  });
}

async function writeMetadata(paths: WorktreeCheckpointStoragePaths): Promise<void> {
  await fs.mkdir(paths.repoDir, { recursive: true });
  await writeJsonAtomic(paths.metadataPath, {
    worktreeId: paths.worktreeId,
    realpath: paths.realpath,
    displayName: path.basename(paths.realpath) || paths.realpath,
    updatedAt: new Date().toISOString(),
  });
}

export interface WorktreeCheckpointStoragePaths {
  readonly worktreeId: string;
  readonly realpath: string;
  readonly repoDir: string;
  readonly gitDir: string;
  readonly indexFile: string;
  readonly metadataPath: string;
}

/** Resolve the Worktree Checkpoint Storage layout for a cwd and update the registry. */
export async function resolveWorktreeCheckpointStoragePaths(
  cwd: string,
): Promise<WorktreeCheckpointStoragePaths> {
  const realpath = await normalizeWorktreePath(cwd);
  const worktreeId = getWorktreeId(realpath);
  const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
  const now = new Date().toISOString();
  await writeRegistryEntry({
    worktreeId,
    realpath,
    displayName: path.basename(realpath) || realpath,
    createdAt: now,
    lastSeenAt: now,
  });
  const paths = {
    worktreeId,
    realpath,
    repoDir,
    gitDir: getGitDir(repoDir),
    indexFile: getIndexPath(repoDir),
    metadataPath: path.join(repoDir, "metadata.json"),
  };
  await writeMetadata(paths);
  return paths;
}

/**
 * Resolve the checkpoint repo directory.
 *
 * This synchronous helper is retained for legacy callers and temporary
 * cross-session handoff files. New checkpoint file storage uses
 * {@link resolveWorktreeCheckpointStoragePaths}.
 */
export function getRepoDir(sessionFile: string | undefined): string {
  if (!sessionFile) {
    return path.join(getLegacySessionsDir(), "ephemeral");
  }
  const base = path.basename(sessionFile, ".jsonl");
  return path.join(getLegacySessionsDir(), base);
}

/** Resolve the bare git repository directory inside a Worktree Checkpoint Storage dir. */
export function getGitDir(repoDir: string): string {
  return path.join(repoDir, "repo.git");
}

/** Resolve the external git index file path (kept outside the work tree). */
export function getIndexPath(repoDir: string): string {
  return path.join(repoDir, "index");
}
