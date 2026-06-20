import fs from "node:fs/promises";
import { RepoManager } from "./repo-manager";
import { withRepoLock } from "./lock";
import { resolveWorktreeCheckpointStoragePaths } from "./resolver";

export interface SessionCheckpointStorageOptions {
  readonly sessionFile: string | undefined;
  readonly cwd: string;
}

export interface EnsureSessionCheckpointStorageOptions extends SessionCheckpointStorageOptions {
  readonly exclude: readonly string[];
  readonly maxFileBytes?: number;
}

export interface CloneSessionCheckpointStorageOptions extends SessionCheckpointStorageOptions {
  readonly previousSessionFile: string;
  readonly exclude?: readonly string[];
  readonly maxFileBytes?: number;
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
      readonly worktreeId: string;
    }
  | { readonly ok: false; readonly reason: "not-found" };

async function createStorage(
  options: SessionCheckpointStorageOptions,
): Promise<Exclude<SessionCheckpointStorageResult, { readonly ok: false }>> {
  const paths = await resolveWorktreeCheckpointStoragePaths(options.cwd);

  return {
    ok: true,
    repo: new RepoManager(paths.gitDir, paths.indexFile, options.cwd),
    repoDir: paths.repoDir,
    gitDir: paths.gitDir,
    indexFile: paths.indexFile,
    worktreeId: paths.worktreeId,
  };
}

export async function resolveSessionCheckpointStorage(
  options: SessionCheckpointStorageOptions,
): Promise<SessionCheckpointStorageResult> {
  const storage = await createStorage(options);

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
  const storage = await createStorage(options);
  storage.repo.setLargeFileLimit(options.maxFileBytes);

  const destinationExists = await fs
    .access(storage.gitDir)
    .then(() => true)
    .catch(() => false);
  if (destinationExists) {
    if (options.exclude) {
      await storage.repo.setExclude(options.exclude);
    }
    return storage;
  }

  await fs.mkdir(storage.repoDir, { recursive: true });
  await storage.repo.init();
  if (options.exclude) {
    await storage.repo.setExclude(options.exclude);
  }
  return storage;
}

export async function safeCloneSessionCheckpointStorage(
  options: CloneSessionCheckpointStorageOptions,
): Promise<CloneSessionCheckpointStorageResult> {
  const storage = await createStorage(options);
  storage.repo.setLargeFileLimit(options.maxFileBytes);

  await fs.mkdir(storage.repoDir, { recursive: true });
  return withRepoLock(storage.repoDir, async () => {
    const destinationExists = await fs
      .access(storage.gitDir)
      .then(() => true)
      .catch(() => false);
    if (destinationExists) {
      if (options.exclude) {
        await storage.repo.setExclude(options.exclude);
      }
      return storage;
    }

    await fs.mkdir(storage.repoDir, { recursive: true });
    await storage.repo.init();
    if (options.exclude) {
      await storage.repo.setExclude(options.exclude);
    }
    return storage;
  });
}

export async function ensureSessionCheckpointStorage(
  options: EnsureSessionCheckpointStorageOptions,
): Promise<Exclude<SessionCheckpointStorageResult, { readonly ok: false }>> {
  const storage = await createStorage(options);
  storage.repo.setLargeFileLimit(options.maxFileBytes);
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
  const storage = await createStorage(options);
  storage.repo.setLargeFileLimit(options.maxFileBytes);
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
