import { vi } from "vitest";
import type { RepoManager } from "../repo-manager";
import type { SafeCheckoutResult } from "../repo-manager";

type RepoMockMethodName =
  | "withLock"
  | "init"
  | "lockedInit"
  | "ensureReady"
  | "lockedEnsureReady"
  | "setExclude"
  | "lockedSetExclude"
  | "checkpoint"
  | "lockedCheckpoint"
  | "checkoutCommit"
  | "lockedCheckoutCommit"
  | "createSafetyCommit"
  | "lockedCreateSafetyCommit"
  | "updateRef"
  | "lockedUpdateRef"
  | "diffStats"
  | "diffWorkingTree"
  | "stageAll"
  | "lockedStageAll"
  | "diffAgainst"
  | "safeCheckout";

type RepoMock = Partial<Record<RepoMockMethodName, (...args: readonly unknown[]) => unknown>>;

function isCallable(fn: unknown): fn is (...args: readonly unknown[]) => unknown {
  return typeof fn === "function";
}

/** Narrow an injected spy to a callable function or undefined. */
function asMock(fn: unknown): ((...args: readonly unknown[]) => unknown) | undefined {
  return isCallable(fn) ? fn : undefined;
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
export function createMockRepo(partial: RepoMock = {}): RepoManager {
  const defaults = {
    withLock: vi.fn((fn: () => Promise<unknown>) => fn()),
  };
  const repo = { ...defaults, ...partial } as unknown as RepoManager & Record<string, unknown>;

  repo.lockedInit = vi.fn(async () => repo.withLock(async () => repo.init()));
  repo.lockedEnsureReady = vi.fn(async (excludePatterns?: readonly string[]) =>
    repo.withLock(async () => repo.ensureReady(excludePatterns)),
  );
  repo.lockedSetExclude = vi.fn(async (patterns: readonly string[]) =>
    repo.withLock(async () => repo.setExclude(patterns)),
  );
  repo.lockedCheckpoint = vi.fn(async (entryId: string) =>
    repo.withLock(async () => {
      const checkpoint = asMock(repo.checkpoint);
      if (!checkpoint) throw new Error("checkpoint not mocked");
      const result = await checkpoint(entryId);
      return typeof result === "string" ? result : String(result);
    }),
  );
  repo.lockedCheckoutCommit = vi.fn(async (commitHash: string) =>
    repo.withLock(async () => repo.checkoutCommit(commitHash)),
  );
  repo.lockedCreateSafetyCommit = vi.fn(async () =>
    repo.withLock(async () => {
      const createSafetyCommit = asMock(repo.createSafetyCommit);
      if (!createSafetyCommit) throw new Error("createSafetyCommit not mocked");
      const result = await createSafetyCommit();
      return typeof result === "string" ? result : String(result);
    }),
  );
  repo.lockedUpdateRef = vi.fn(async (ref: string, commitHash: string) =>
    repo.withLock(async () => repo.updateRef(ref, commitHash)),
  );
  repo.lockedStageAll = vi.fn(async () => repo.withLock(async () => repo.stageAll()));

  if (!partial?.safeCheckout) {
    repo.safeCheckout = vi.fn(
      async (targetCommit: string, dirtyBaseCommit?: string): Promise<SafeCheckoutResult> => {
        if (dirtyBaseCommit) {
          try {
            const stageAll = asMock(repo.stageAll);
            if (stageAll) await stageAll();

            const diffAgainst = asMock(repo.diffAgainst);
            const dirtyResult = diffAgainst ? await diffAgainst(dirtyBaseCommit) : "";
            const dirtyStdout = typeof dirtyResult === "string" ? dirtyResult : "";
            if (dirtyStdout.trim().length > 0) {
              return {
                ok: false,
                reason: "dirty",
                message: "Workspace has unsnapshotted checkpoint-managed changes.",
              };
            }
          } catch (error) {
            return {
              ok: false,
              reason: "dirty-check-failed",
              message: "Could not verify the workspace is clean against the checkpoint base.",
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        let safetyHash: string | undefined;
        try {
          const createSafetyCommit = asMock(repo.createSafetyCommit);
          if (createSafetyCommit) {
            const result = await createSafetyCommit();
            if (typeof result === "string") safetyHash = result;
          }
        } catch (error) {
          return {
            ok: false,
            reason: "preflight-failed",
            message: "Failed to create a safety checkpoint before restore.",
            error: error instanceof Error ? error.message : String(error),
          };
        }

        const checkoutCommit = asMock(repo.checkoutCommit);
        if (!checkoutCommit) {
          return {
            ok: false,
            reason: "checkout-failed",
            message: "Checkpoint restore failed.",
            error: "checkoutCommit not mocked",
          };
        }

        try {
          await checkoutCommit(targetCommit);
          return safetyHash ? { ok: true, safetyHash } : { ok: true };
        } catch (error) {
          if (safetyHash) {
            try {
              await checkoutCommit(safetyHash);
            } catch (rollbackError) {
              return {
                ok: false,
                reason: "rollback-failed",
                message:
                  "Checkpoint restore failed and rollback could not recover the previous state.",
                error: error instanceof Error ? error.message : String(error),
                rollbackError:
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              };
            }
          }
          return {
            ok: false,
            reason: "checkout-failed",
            message: "Checkpoint restore failed.",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  return repo;
}
