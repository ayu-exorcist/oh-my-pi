import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import type { RepoManager, CheckpointEntry, RepoProvider } from "@ayulab/pi-checkpoint";
import {
  RepoManager as RepoManagerClass,
  getCheckpointEntries,
  getRepoDir,
  getGitDir,
  getIndexPath,
  createDefaultRepoProvider,
  errorMessage,
} from "@ayulab/pi-checkpoint";

/** Per-session redo stack entry — records where we were before an undo. */
interface RedoEntry {
  readonly targetLeafId: string;
  readonly afterCommit: string;
}

/** Convenience helper to get all checkpoints for the current session. */
function getCheckpoints(ctx: ExtensionContext): readonly CheckpointEntry[] {
  return getCheckpointEntries(ctx.sessionManager.getEntries());
}

/**
 * Pi extension entry point — registers `/undo` and `/redo` commands.
 *
 * Both commands rely on checkpoint entries created by `@ayulab/pi-rewind` (or
 * any other extension that writes `pi-checkpoint` custom entries).
 *
 * @param pi - Extension API.
 * @param provider - Optional repo provider for testing. Defaults to a
 *   filesystem-aware provider that binds repos on `session_start`.
 */
export default function (pi: ExtensionAPI, provider?: RepoProvider) {
  const repos = provider ?? createDefaultRepoProvider();
  const redoStacks = new Map<string, RedoEntry[]>();

  function getRepo(sessionId: string): RepoManager | undefined {
    return repos.getRepo(sessionId);
  }

  /** Lazy-create a redo stack for the given session. */
  function getStack(sessionId: string): RedoEntry[] {
    let stack = redoStacks.get(sessionId);
    if (!stack) {
      stack = [];
      redoStacks.set(sessionId, stack);
    }
    return stack;
  }

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    redoStacks.delete(sessionId);

    const sessionFile = ctx.sessionManager.getSessionFile();
    const repoDir = getRepoDir(sessionFile);
    const gitDir = getGitDir(repoDir);
    const indexFile = getIndexPath(repoDir);

    // Only bind a repo if the checkpoint directory already exists
    // (created by pi-rewind or another checkpoint-aware extension).
    const gitExists = await fs
      .access(gitDir)
      .then(() => true)
      .catch(() => false);

    if (gitExists) {
      repos.setRepo(sessionId, new RepoManagerClass(gitDir, indexFile, ctx.cwd));
    }
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

      const repo = getRepo(ctx.sessionManager.getSessionId());
      if (!repo) {
        ctx.ui.notify("Checkpoint extension not ready", "warning");
        return;
      }

      const cps = getCheckpoints(ctx);
      if (cps.length === 0) {
        ctx.ui.notify("Nothing to undo.", "info");
        return;
      }

      const cp = cps[cps.length - 1];
      /* istanbul ignore next */
      /* c8 ignore next 3 */
      if (!cp) {
        ctx.ui.notify("Nothing to undo.", "info");
        return;
      }

      const currentLeafId = ctx.sessionManager.getLeafId();
      const result = await repo.safeCheckout(cp.beforeCommit, cp.afterCommit);

      if (!result.ok) {
        if (result.reason === "dirty") {
          ctx.ui.notify(
            "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before undoing.",
            "warning",
          );
        } else {
          if (result.rollbackError) {
            ctx.ui.notify(`Undo failed and rollback also failed: ${result.rollbackError}`, "error");
          } else {
            ctx.ui.notify(`Undo failed: ${result.error}`, "error");
          }
        }
        return;
      }

      if (currentLeafId) {
        getStack(ctx.sessionManager.getSessionId()).push({
          targetLeafId: currentLeafId,
          afterCommit: cp.afterCommit,
        });
      }

      try {
        await ctx.navigateTree(cp.userEntryId, { summarize: false });
      } catch (err) {
        ctx.ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
        return;
      }

      ctx.ui.notify("Undo complete. Workspace restored to before that turn.", "info");
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

      const repo = getRepo(ctx.sessionManager.getSessionId());
      if (!repo) {
        ctx.ui.notify("Checkpoint extension not ready", "warning");
        return;
      }

      const stack = getStack(ctx.sessionManager.getSessionId());
      const entry = stack.pop();
      if (!entry) {
        ctx.ui.notify("Nothing to redo.", "info");
        return;
      }

      const cps = getCheckpoints(ctx);
      const latest = cps[cps.length - 1];
      const result = await repo.safeCheckout(entry.afterCommit, latest?.afterCommit);

      if (!result.ok) {
        if (result.reason === "dirty") {
          ctx.ui.notify(
            "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before redoing.",
            "warning",
          );
        } else {
          if (result.rollbackError) {
            ctx.ui.notify(`Redo failed and rollback also failed: ${result.rollbackError}`, "error");
          } else {
            ctx.ui.notify(`Redo failed: ${result.error}`, "error");
          }
        }
        return;
      }

      try {
        await ctx.navigateTree(entry.targetLeafId, { summarize: false });
      } catch (err) {
        ctx.ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
        return;
      }

      ctx.ui.notify("Redo complete. Workspace restored.", "info");
    },
  });
}

export { createDefaultRepoProvider };
export type { RepoProvider };
