import { vi, type Mock } from "vitest";
import type { RepoManager } from "../repo-manager";
import type { SafeCheckoutResult } from "../repo-manager";

/** Narrow an injected spy to a callable Mock or undefined. */
function asMock<T extends (...args: any[]) => any>(fn: unknown): Mock<T> | undefined {
  return typeof fn === "function" ? (fn as Mock<T>) : undefined;
}

/**
 * Create a mock {@link RepoManager} for tests.
 *
 * Provides a default `withLock` passthrough and a fully-implemented
 * `safeCheckout` that delegates to injected `stageAll`, `diffAgainst`,
 * `createSafetyCommit`, and `checkoutCommit` spies. This means tests
 * exercise the real decision tree rather than a hand-rolled reimplementation.
 *
 * @example
 * const repo = createMockRepo({
 *   stageAll: vi.fn().mockResolvedValue(undefined),
 *   diffAgainst: vi.fn().mockResolvedValue(""),
 *   createSafetyCommit: vi.fn().mockResolvedValue("safety"),
 *   checkoutCommit: vi.fn().mockResolvedValue(undefined),
 * });
 */
export function createMockRepo(
  partial: Partial<Record<keyof RepoManager, Mock>> = {},
): RepoManager {
  const defaults = {
    withLock: vi.fn((fn: () => Promise<unknown>) => fn()),
  };
  const repo = { ...defaults, ...partial } as unknown as RepoManager & Record<string, unknown>;

  if (!partial?.safeCheckout) {
    repo.safeCheckout = vi.fn(
      async (targetCommit: string, dirtyBaseCommit?: string): Promise<SafeCheckoutResult> => {
        if (dirtyBaseCommit) {
          try {
            const stageAll = asMock(repo.stageAll);
            if (stageAll) await stageAll();

            const diffAgainst = asMock<typeof repo.diffAgainst>(repo.diffAgainst);
            const dirtyStdout = diffAgainst ? await diffAgainst(dirtyBaseCommit) : "";
            if (dirtyStdout.trim().length > 0) {
              return { ok: false as const, reason: "dirty" };
            }
          } catch {
            // skip dirty check if diff fails
          }
        }

        let safetyHash: string | undefined;
        try {
          const createSafetyCommit = asMock<typeof repo.createSafetyCommit>(
            repo.createSafetyCommit,
          );
          if (createSafetyCommit) safetyHash = await createSafetyCommit();
        } catch {
          // proceed without safety commit
        }

        const checkoutCommit = asMock(repo.checkoutCommit);
        if (!checkoutCommit) {
          return {
            ok: false as const,
            reason: "checkout-failed",
            error: "checkoutCommit not mocked",
          };
        }

        try {
          await checkoutCommit(targetCommit);
          return { ok: true as const, safetyHash };
        } catch (err) {
          if (safetyHash) {
            try {
              await checkoutCommit(safetyHash);
            } catch (rollbackErr) {
              return {
                ok: false as const,
                reason: "checkout-failed",
                error: err instanceof Error ? err.message : String(err),
                rollbackError:
                  rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
              };
            }
          }
          return {
            ok: false as const,
            reason: "checkout-failed",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    );
  }

  return repo as RepoManager;
}
