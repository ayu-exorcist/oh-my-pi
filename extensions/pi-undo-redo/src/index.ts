import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CheckpointEntry, RepoProvider } from "@ayulab/pi-checkpoint";
import {
  getCheckpointEntries,
  createDefaultRepoProvider,
  bindSessionRepo,
} from "@ayulab/pi-checkpoint";
import { SessionStateMap } from "@ayulab/pi-checkpoint";
import { hasItems } from "@ayulab/runtime-core";
import { restoreRedoTarget, restoreUndoTarget } from "./restore";

/** Per-session redo stack entry — records where we were before an undo. */
interface RedoEntry {
  readonly targetLeafId: string;
  readonly afterCommit: string;
}

const checkpointStorageMissingMessage =
  "Checkpoint storage not found. This session has checkpoints, but their file snapshots are missing.";

/** Convenience helper to get all checkpoints for the current session. */
function getCheckpoints(ctx: ExtensionContext): readonly CheckpointEntry[] {
  return getCheckpointEntries(ctx.sessionManager.getEntries());
}

/**
 * Pi extension entry point — registers `/undo` and `/redo` commands.
 *
 * Both commands consume checkpoint entries written by a checkpoint-aware
 * extension (e.g. `@ayulab/pi-rewind`). If no such extension is active,
 * undo/redo will report that nothing is available.
 *
 * @param pi - Extension API.
 * @param provider - Optional repo provider for testing. Defaults to a
 *   filesystem-aware provider that binds repos on `session_start`.
 */
export default function (pi: ExtensionAPI, provider?: RepoProvider) {
  const repos = provider ?? createDefaultRepoProvider();
  const redoStacks = new SessionStateMap<RedoEntry[]>();

  /** Lazy-create a redo stack for the given session. */
  function getStack(sessionId: string): RedoEntry[] {
    return redoStacks.get(sessionId, () => []);
  }

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    redoStacks.delete(sessionId);

    await bindSessionRepo(sessionId, ctx.sessionManager.getSessionFile(), ctx.cwd, repos);
  });

  /** Clean up the in-memory repo reference when the session ends. */
  pi.on("session_shutdown", async (_event, ctx) => {
    repos.deleteRepo(ctx.sessionManager.getSessionId());
  });

  /**
   * `/undo` — revert to the checkpoint taken before the latest turn.
   *
   * Flow:
   *   1. Dirty-guard: warn if workspace has unsnapshotted changes.
   *   2. Create a safety commit for automatic rollback on failure.
   *   3. Checkout the `beforeCommit` of the latest checkpoint.
   *   4. Push the current leaf onto the redo stack.
   *   5. Navigate the conversation tree back to the checkpoint entry.
   */
  pi.registerCommand("undo", {
    description: "Undo last agent turn and restore workspace",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const cps = getCheckpoints(ctx);
      if (!hasItems(cps)) {
        ctx.ui.notify(
          "Nothing to undo. Make sure a checkpoint-aware extension (e.g. @ayulab/pi-rewind) is installed and has created checkpoints for this session.",
          "info",
        );
        return;
      }

      const repo = await bindSessionRepo(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getSessionFile(),
        ctx.cwd,
        repos,
      );
      if (!repo) {
        ctx.ui.notify(checkpointStorageMissingMessage, "warning");
        return;
      }

      const cp = cps[0];

      const currentLeafId = ctx.sessionManager.getLeafId();
      const result = await restoreUndoTarget({
        repo,
        ui: ctx.ui,
        navigateTree: ctx.navigateTree,
        targetCommit: cp.beforeCommit,
        dirtyBaseCommit: cp.afterCommit,
        targetLeafId: cp.userEntryId,
      });

      if (!result.ok) return;

      if (currentLeafId) {
        getStack(ctx.sessionManager.getSessionId()).push({
          targetLeafId: currentLeafId,
          afterCommit: cp.afterCommit,
        });
      }
    },
  });

  /**
   * `/redo` — restore a turn that was previously undone.
   *
   * Pops the top entry from the redo stack and checks out its `afterCommit`,
   * then navigates the conversation tree forward to the leaf that was active
   * before the undo.
   */
  pi.registerCommand("redo", {
    description: "Redo previously undone agent turn and restore workspace",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const stack = getStack(ctx.sessionManager.getSessionId());
      const entry = stack.at(-1);
      if (!entry) {
        ctx.ui.notify("Nothing to redo.", "info");
        return;
      }

      const repo = await bindSessionRepo(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getSessionFile(),
        ctx.cwd,
        repos,
      );
      if (!repo) {
        ctx.ui.notify(checkpointStorageMissingMessage, "warning");
        return;
      }

      const cps = getCheckpoints(ctx);
      const latest = cps.at(-1);
      const result = await restoreRedoTarget({
        repo,
        ui: ctx.ui,
        navigateTree: ctx.navigateTree,
        targetCommit: entry.afterCommit,
        dirtyBaseCommit: latest?.afterCommit,
        targetLeafId: entry.targetLeafId,
      });

      if (result.ok) {
        stack.pop();
      }
    },
  });
}

export { createDefaultRepoProvider };
export type { RepoProvider };
