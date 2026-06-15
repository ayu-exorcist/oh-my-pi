import type { RepoManager } from "./repo-manager";
import type { RepoProvider } from "./repo-provider";
import {
  resolveSessionCheckpointStorage,
  safeEnsureSessionCheckpointStorage,
} from "./session-checkpoint-storage";

/**
 * Bind a checkpoint repo to the given session.
 *
 * If the session already has a repo bound, returns it immediately.
 * If `exclude` is provided, ensures the repo exists (creates + initializes if needed).
 * Otherwise resolves an existing repo; returns undefined if none exists.
 */
export function bindSessionRepo(
  sessionId: string,
  sessionFile: string | undefined,
  cwd: string,
  repos: RepoProvider,
  options: { readonly exclude: readonly string[] },
): Promise<RepoManager>;
export function bindSessionRepo(
  sessionId: string,
  sessionFile: string | undefined,
  cwd: string,
  repos: RepoProvider,
  options?: { readonly exclude?: readonly string[] },
): Promise<RepoManager | undefined>;
export async function bindSessionRepo(
  sessionId: string,
  sessionFile: string | undefined,
  cwd: string,
  repos: RepoProvider,
  options?: { readonly exclude?: readonly string[] },
): Promise<RepoManager | undefined> {
  const existing = repos.getRepo(sessionId);
  if (existing) return existing;

  if (options?.exclude) {
    const storage = await safeEnsureSessionCheckpointStorage({
      sessionFile,
      cwd,
      exclude: options.exclude,
    });
    repos.setRepo(sessionId, storage.repo);
    return storage.repo;
  }

  const storage = await resolveSessionCheckpointStorage({ sessionFile, cwd });
  if (!storage.ok) return undefined;

  repos.setRepo(sessionId, storage.repo);
  return storage.repo;
}
