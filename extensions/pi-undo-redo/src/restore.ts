import type { NavigateTreeOptions, RepoManager, RestoreResult } from "@ayulab/pi-checkpoint";
import { safeRestore } from "@ayulab/pi-checkpoint";

interface RestoreUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
}

interface RestoreTargetOptions {
  readonly repo: RepoManager;
  readonly ui: RestoreUi;
  readonly navigateTree: (
    entryId: string,
    options: NavigateTreeOptions,
  ) => Promise<{ readonly cancelled: boolean; readonly editorText?: string }>;
  readonly targetCommit: string;
  readonly dirtyBaseCommit: string | undefined;
  readonly targetLeafId: string;
}

export type { RestoreResult };

export function restoreUndoTarget(options: RestoreTargetOptions): Promise<RestoreResult> {
  return safeRestore({
    ...options,
    dirtyMessage:
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before undoing.",
    failedPrefix: "Undo failed",
    rollbackFailedPrefix: "Undo failed and rollback also failed",
    successMessage: "Undo complete. Workspace restored to before that turn.",
  });
}

export function restoreRedoTarget(options: RestoreTargetOptions): Promise<RestoreResult> {
  return safeRestore({
    ...options,
    dirtyMessage:
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before redoing.",
    failedPrefix: "Redo failed",
    rollbackFailedPrefix: "Redo failed and rollback also failed",
    successMessage: "Redo complete. Workspace restored.",
  });
}
