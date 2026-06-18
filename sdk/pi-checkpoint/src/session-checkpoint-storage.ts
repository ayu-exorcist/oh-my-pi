import fs from "node:fs/promises";
import { RepoManager } from "./repo-manager";
import { withRepoLock } from "./lock";
import { getGitDir, getIndexPath, getRepoDir } from "./resolver";

export interface SessionCheckpointStorageOptions {
  readonly sessionFile: string | undefined;
  readonly cwd: string;
}

export interface EnsureSessionCheckpointStorageOptions extends SessionCheckpointStorageOptions {
  readonly exclude: readonly string[];
}

export interface CloneSessionCheckpointStorageOptions extends SessionCheckpointStorageOptions {
  readonly previousSessionFile: string;
  readonly exclude?: readonly string[];
}

export type CloneSessionCheckpointStorageResult =
  | Exclude<SessionCheckpointStorageResult, { readonly ok: false }>
  | { readonly ok: false; readonly reason: "source-not-found" | "destination-exists" };

export type SessionCheckpointStorageResult =
  | {
      readonly ok: true;
      readonly repo: RepoManager;
      readonly repoDir: string;
      readonly gitDir: string;
      readonly indexFile: string;
    }
  | { readonly ok: false; readonly reason: "not-found" };

function createStorage(
  options: SessionCheckpointStorageOptions,
): Exclude<SessionCheckpointStorageResult, { readonly ok: false }> {
  const repoDir = getRepoDir(options.sessionFile);
  const gitDir = getGitDir(repoDir);
  const indexFile = getIndexPath(repoDir);

  return {
    ok: true,
    repo: new RepoManager(gitDir, indexFile, options.cwd),
    repoDir,
    gitDir,
    indexFile,
  };
}

export async function resolveSessionCheckpointStorage(
  options: SessionCheckpointStorageOptions,
): Promise<SessionCheckpointStorageResult> {
  const storage = createStorage(options);

  const exists = await fs
    .access(storage.gitDir)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    return { ok: false, reason: "not-found" };
  }

  return storage;
}

export async function cloneSessionCheckpointStorage(
  options: CloneSessionCheckpointStorageOptions,
): Promise<CloneSessionCheckpointStorageResult> {
  const sourceRepoDir = getRepoDir(options.previousSessionFile);
  const sourceGitDir = getGitDir(sourceRepoDir);
  const storage = createStorage(options);

  const sourceExists = await fs
    .access(sourceRepoDir)
    .then(() => true)
    .catch(() => false);
  if (!sourceExists) return { ok: false, reason: "source-not-found" };

  const destinationExists = await fs
    .access(storage.gitDir)
    .then(() => true)
    .catch(() => false);
  if (destinationExists) return { ok: false, reason: "destination-exists" };

  await fs.mkdir(storage.repoDir, { recursive: true });
  await RepoManager.cloneFrom(sourceGitDir, storage.gitDir);
  if (options.exclude) {
    await storage.repo.setExclude(options.exclude);
  }
  return storage;
}

export async function safeCloneSessionCheckpointStorage(
  options: CloneSessionCheckpointStorageOptions,
): Promise<CloneSessionCheckpointStorageResult> {
  const sourceRepoDir = getRepoDir(options.previousSessionFile);
  const sourceGitDir = getGitDir(sourceRepoDir);
  const storage = createStorage(options);

  await fs.mkdir(storage.repoDir, { recursive: true });
  return withRepoLock(storage.repoDir, async () => {
    const sourceExists = await fs
      .access(sourceRepoDir)
      .then(() => true)
      .catch(() => false);
    if (!sourceExists) return { ok: false, reason: "source-not-found" };

    const destinationExists = await fs
      .access(storage.gitDir)
      .then(() => true)
      .catch(() => false);
    if (destinationExists) return { ok: false, reason: "destination-exists" };

    await fs.mkdir(storage.repoDir, { recursive: true });
    await RepoManager.cloneFrom(sourceGitDir, storage.gitDir);
    if (options.exclude) {
      await storage.repo.setExclude(options.exclude);
    }
    return storage;
  });
}

export async function ensureSessionCheckpointStorage(
  options: EnsureSessionCheckpointStorageOptions,
): Promise<Exclude<SessionCheckpointStorageResult, { readonly ok: false }>> {
  const storage = createStorage(options);
  const exists = await fs
    .access(storage.gitDir)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await storage.repo.init();
  }

  await storage.repo.setExclude(options.exclude);

  return storage;
}

export async function safeEnsureSessionCheckpointStorage(
  options: EnsureSessionCheckpointStorageOptions,
): Promise<Exclude<SessionCheckpointStorageResult, { readonly ok: false }>> {
  const storage = createStorage(options);
  await fs.mkdir(storage.repoDir, { recursive: true });
  return withRepoLock(storage.repoDir, async () => {
    const exists = await fs
      .access(storage.gitDir)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await storage.repo.init();
    }

    await storage.repo.setExclude(options.exclude);

    return storage;
  });
}
