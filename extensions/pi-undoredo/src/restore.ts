import type { RepoManager } from "@ayulab/pi-checkpoint";
import { errorMessage } from "@ayulab/pi-checkpoint";

interface RestoreUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
}

interface RestoreTargetOptions {
  readonly repo: RepoManager;
  readonly ui: RestoreUi;
  readonly navigateTree: (
    entryId: string,
    options: { readonly summarize: false },
  ) => Promise<unknown>;
  readonly targetCommit: string;
  readonly dirtyBaseCommit: string | undefined;
  readonly targetLeafId: string;
}

export type RestoreTargetResult = { readonly ok: true } | { readonly ok: false };

async function restoreTarget(
  options: RestoreTargetOptions & {
    readonly dirtyMessage: string;
    readonly failedPrefix: string;
    readonly rollbackFailedPrefix: string;
    readonly successMessage: string;
  },
): Promise<RestoreTargetResult> {
  const result = await options.repo.safeCheckout(options.targetCommit, options.dirtyBaseCommit);

  if (!result.ok) {
    if (result.reason === "dirty") {
      options.ui.notify(options.dirtyMessage, "warning");
      return { ok: false };
    }
    if (result.rollbackError) {
      options.ui.notify(`${options.rollbackFailedPrefix}: ${result.rollbackError}`, "error");
      return { ok: false };
    }
    options.ui.notify(`${options.failedPrefix}: ${result.error}`, "error");
    return { ok: false };
  }

  try {
    await options.navigateTree(options.targetLeafId, { summarize: false });
  } catch (err) {
    options.ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
    return { ok: false };
  }

  options.ui.notify(options.successMessage, "info");
  return { ok: true };
}

export function restoreUndoTarget(options: RestoreTargetOptions): Promise<RestoreTargetResult> {
  return restoreTarget({
    ...options,
    dirtyMessage:
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before undoing.",
    failedPrefix: "Undo failed",
    rollbackFailedPrefix: "Undo failed and rollback also failed",
    successMessage: "Undo complete. Workspace restored to before that turn.",
  });
}

export function restoreRedoTarget(options: RestoreTargetOptions): Promise<RestoreTargetResult> {
  return restoreTarget({
    ...options,
    dirtyMessage:
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before redoing.",
    failedPrefix: "Redo failed",
    rollbackFailedPrefix: "Redo failed and rollback also failed",
    successMessage: "Redo complete. Workspace restored.",
  });
}
