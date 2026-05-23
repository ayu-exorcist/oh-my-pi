import type { RepoManager } from "./repo-manager";

/**
 * Storage seam for repo lifecycle.
 *
 * Production uses an in-memory Map-backed adapter. Tests inject a
 * mock adapter so they never reach the real filesystem.
 *
 * One adapter = hypothetical seam. Two adapters (default + mock) = real seam.
 */
export interface RepoProvider {
  getRepo(sessionId: string): RepoManager | undefined;
  setRepo(sessionId: string, repo: RepoManager): void;
  deleteRepo(sessionId: string): void;
}

/** Default production adapter backed by an in-memory Map. */
export function createDefaultRepoProvider(): RepoProvider {
  const repos = new Map<string, RepoManager>();
  return {
    getRepo(id) {
      return repos.get(id);
    },
    setRepo(id, repo) {
      repos.set(id, repo);
    },
    deleteRepo(id) {
      repos.delete(id);
    },
  };
}
