import type {
  CheckpointEntry,
  NavigateTreeOptions,
  NavigateTreeResult,
  RepoManager,
} from "@ayulab/pi-checkpoint";
import { safeRestore } from "@ayulab/pi-checkpoint";
import { errorMessage } from "@ayulab/runtime-core";

interface RestoreModeUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
  input(message: string, initialValue: string): Promise<string | undefined>;
}

interface RunRestoreModeOptions {
  readonly mode: string;
  readonly repo: RepoManager;
  readonly ui: RestoreModeUi;
  readonly navigateTree: (
    entryId: string,
    options?: NavigateTreeOptions,
  ) => Promise<NavigateTreeResult>;
  readonly targetCp: CheckpointEntry;
  readonly latestCp: CheckpointEntry;
  readonly conversationEntryId?: string;
  readonly dirtyBaseCommit?: string;
}

function checkpointBeforeState(checkpoint: CheckpointEntry): string {
  return checkpoint.beforeState;
}

function checkpointAfterState(checkpoint: CheckpointEntry): string {
  return checkpoint.afterState;
}

export async function runRestoreMode(options: RunRestoreModeOptions): Promise<void> {
  const conversationEntryId = options.conversationEntryId ?? options.targetCp.userEntryId;
  const restoreCode = options.mode === "Restore code";
  const restoreCodeAndConversation = options.mode === "Restore code and conversation";
  const restoreConversation = options.mode === "Restore conversation";
  const targetBeforeState = checkpointBeforeState(options.targetCp);
  const latestAfterState = checkpointAfterState(options.latestCp);

  if (restoreCodeAndConversation) {
    await safeRestore({
      repo: options.repo,
      ui: options.ui,
      navigateTree: options.navigateTree,
      targetCommit: targetBeforeState,
      dirtyBaseCommit: options.dirtyBaseCommit ?? latestAfterState,
      targetLeafId: conversationEntryId,
      dirtyMessage:
        "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.",
      failedPrefix: "Rewind failed",
      rollbackFailedPrefix: "Rewind failed and rollback also failed",
      successMessage: "Rewind completed",
    });
    return;
  }

  if (restoreCode) {
    const result = await safeRestore({
      repo: options.repo,
      ui: options.ui,
      navigateTree: async (_entryId, _options) => ({ cancelled: false }),
      targetCommit: targetBeforeState,
      dirtyBaseCommit: options.dirtyBaseCommit ?? latestAfterState,
      targetLeafId: conversationEntryId,
      dirtyMessage:
        "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.",
      failedPrefix: "Rewind failed",
      rollbackFailedPrefix: "Rewind failed and rollback also failed",
      successMessage: "Rewind completed",
    });
    if (!result.ok) return;
  }

  if (restoreConversation) {
    try {
      await options.navigateTree(conversationEntryId, { summarize: false });
    } catch (err) {
      options.ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
      return;
    }
  }

  options.ui.notify("Rewind completed", "info");
}
