import type {
  CheckpointEntry,
  NavigateTreeOptions,
  NavigateTreeResult,
  RepoManager,
  SafeCheckoutResult,
} from "@ayulab/pi-checkpoint";
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

function notifyCheckoutFailure(
  ui: RestoreModeUi,
  result: Exclude<SafeCheckoutResult, { readonly ok: true }>,
  dirtyMessage: string,
  dirtyCheckFailedMessage: string,
  failedPrefix: string,
  rollbackFailedPrefix: string,
): void {
  if (result.reason === "dirty") {
    ui.notify(dirtyMessage, "warning");
    return;
  }

  if (result.reason === "dirty-check-failed") {
    ui.notify(dirtyCheckFailedMessage, "warning");
    return;
  }

  if (result.rollbackError) {
    ui.notify(`${rollbackFailedPrefix}: ${result.rollbackError}`, "error");
    return;
  }

  ui.notify(
    `${failedPrefix}: ${result.message ?? result.error ?? "checkpoint restore failed"}`,
    "error",
  );
}

async function restoreConversation(
  ui: RestoreModeUi,
  navigateTree: RunRestoreModeOptions["navigateTree"],
  entryId: string,
): Promise<boolean> {
  try {
    await navigateTree(entryId, { summarize: false });
    return true;
  } catch (err) {
    ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
    return false;
  }
}

export async function runRestoreMode(options: RunRestoreModeOptions): Promise<void> {
  const conversationEntryId = options.conversationEntryId ?? options.targetCp.userEntryId;
  const restoreCode = options.mode === "Restore code";
  const restoreCodeAndConversation = options.mode === "Restore code and conversation";
  const restoreConversationOnly = options.mode === "Restore conversation";
  const dirtyBaseCommit = options.dirtyBaseCommit ?? options.latestCp.afterCommit;
  const dirtyMessage =
    "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.";
  const dirtyCheckFailedMessage =
    "Could not verify the workspace is clean. Run /checkpoint first, or clean them up before rewinding.";
  const failedPrefix = "Rewind failed";
  const rollbackFailedPrefix = "Rewind failed and rollback also failed";

  if (restoreCodeAndConversation) {
    const result = await options.repo.safeCheckout(options.targetCp.beforeCommit, dirtyBaseCommit);
    if (!result.ok) {
      notifyCheckoutFailure(
        options.ui,
        result,
        dirtyMessage,
        dirtyCheckFailedMessage,
        failedPrefix,
        rollbackFailedPrefix,
      );
    }

    const conversationRestored = await restoreConversation(
      options.ui,
      options.navigateTree,
      conversationEntryId,
    );
    if (!conversationRestored) return;

    options.ui.notify(
      result.ok ? "Rewind completed" : "Conversation restored, but files were not restored.",
      result.ok ? "info" : "warning",
    );
    return;
  }

  if (restoreCode) {
    const result = await options.repo.safeCheckout(options.targetCp.beforeCommit, dirtyBaseCommit);
    if (!result.ok) {
      notifyCheckoutFailure(
        options.ui,
        result,
        dirtyMessage,
        dirtyCheckFailedMessage,
        failedPrefix,
        rollbackFailedPrefix,
      );
      return;
    }

    options.ui.notify("Rewind completed", "info");
    return;
  }

  if (restoreConversationOnly) {
    const conversationRestored = await restoreConversation(
      options.ui,
      options.navigateTree,
      conversationEntryId,
    );
    if (!conversationRestored) return;
  }

  options.ui.notify("Rewind completed", "info");
}
