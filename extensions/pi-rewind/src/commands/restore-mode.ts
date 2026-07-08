import type {
  CheckpointEntry,
  NavigateTreeOptions,
  NavigateTreeResult,
  RepoManager,
  SafeCheckoutResult,
} from "@ayulab/pi-checkpoint";
import { errorMessage } from "@ayulab/runtime-core";

const checkpointStorageMissingConversationMessage =
  "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.";
const checkpointTargetMissingMessage =
  "Files were not restored because the selected checkpoint is not present in checkpoint storage.";

interface RestoreModeUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
  input(message: string, initialValue: string): Promise<string | undefined>;
  select?(message: string, options: readonly string[]): Promise<string | undefined>;
  setEditorText?(text: string): void;
}

interface RunRestoreModeOptions {
  readonly mode: string;
  readonly repo?: RepoManager;
  readonly ui: RestoreModeUi;
  readonly navigateTree: (
    entryId: string,
    options?: NavigateTreeOptions,
  ) => Promise<NavigateTreeResult>;
  readonly targetCp: CheckpointEntry;
  readonly latestCp: CheckpointEntry;
  readonly conversationEntryId?: string;
  readonly dirtyBaseCommit?: string;
  readonly onCodeRestore?: (commitHash: string) => void;
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
    ui.notify(result.message ? `${dirtyMessage}\n${result.message}` : dirtyMessage, "warning");
    return;
  }

  if (result.reason === "dirty-check-failed") {
    ui.notify(dirtyCheckFailedMessage, "warning");
    return;
  }

  if (result.reason === "storage-missing") {
    ui.notify(checkpointStorageMissingConversationMessage, "warning");
    return;
  }

  if (result.reason === "target-missing") {
    ui.notify(checkpointTargetMissingMessage, "warning");
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
    const result = await navigateTree(entryId, { summarize: false });
    if (typeof result?.editorText === "string") ui.setEditorText?.(result.editorText);
    return true;
  } catch (err) {
    ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
    return false;
  }
}

async function promptDirtyConversationFallback(
  ui: RestoreModeUi,
  details: string,
): Promise<"Restore conversation only" | "Force restore code and conversation" | "Cancel"> {
  if (!ui.select) return "Cancel";

  const selection = await ui.select(
    `${details}\n\nFiles cannot be restored safely.\n\nChoose one:`,
    ["Restore conversation only", "Force restore code and conversation", "Cancel"],
  );
  return selection === "Restore conversation only" ||
    selection === "Force restore code and conversation"
    ? selection
    : "Cancel";
}

async function restoreCodeAndConversationAfterConflict(
  options: RunRestoreModeOptions,
  conversationEntryId: string,
  dirtyMessage: string,
  dirtyCheckFailedMessage: string,
  failedPrefix: string,
  rollbackFailedPrefix: string,
): Promise<void> {
  if (!options.repo) {
    options.ui.notify(checkpointStorageMissingConversationMessage, "warning");
    return;
  }

  const result = await options.repo.safeCheckout(
    options.targetCp.beforeCommit,
    options.dirtyBaseCommit ?? options.latestCp.afterCommit,
  );
  if (result.ok) {
    options.onCodeRestore?.(options.targetCp.beforeCommit);
    const conversationRestored = await restoreConversation(
      options.ui,
      options.navigateTree,
      conversationEntryId,
    );
    if (!conversationRestored) return;
    options.ui.notify("Rewind completed", "info");
    return;
  }

  if (result.reason !== "dirty") {
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

  const selection = await promptDirtyConversationFallback(
    options.ui,
    result.message ?? dirtyMessage,
  );
  if (selection === "Cancel") return;

  if (selection === "Restore conversation only") {
    const conversationRestored = await restoreConversation(
      options.ui,
      options.navigateTree,
      conversationEntryId,
    );
    if (!conversationRestored) return;
    options.ui.notify("Rewind completed", "info");
    return;
  }

  const forcedResult = await options.repo.safeCheckout(options.targetCp.beforeCommit);
  if (!forcedResult.ok) {
    notifyCheckoutFailure(
      options.ui,
      forcedResult,
      dirtyMessage,
      dirtyCheckFailedMessage,
      failedPrefix,
      rollbackFailedPrefix,
    );
    return;
  }

  options.onCodeRestore?.(options.targetCp.beforeCommit);
  const conversationRestored = await restoreConversation(
    options.ui,
    options.navigateTree,
    conversationEntryId,
  );
  if (!conversationRestored) return;
  options.ui.notify("Rewind completed", "info");
}

export async function runRestoreMode(options: RunRestoreModeOptions): Promise<void> {
  const conversationEntryId = options.conversationEntryId ?? options.targetCp.userEntryId;
  const restoreCode = options.mode === "Restore code";
  const restoreCodeAndConversation = options.mode === "Restore code and conversation";
  const restoreConversationOnly = options.mode === "Restore conversation";
  const dirtyBaseCommit = options.dirtyBaseCommit ?? options.latestCp.afterCommit;
  const dirtyMessage =
    "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before rewinding.";
  const dirtyCheckFailedMessage =
    "Could not verify the workspace is clean. Clean up workspace changes before rewinding.";
  const failedPrefix = "Rewind failed";
  const rollbackFailedPrefix = "Rewind failed and rollback also failed";

  if (restoreCodeAndConversation) {
    await restoreCodeAndConversationAfterConflict(
      options,
      conversationEntryId,
      dirtyMessage,
      dirtyCheckFailedMessage,
      failedPrefix,
      rollbackFailedPrefix,
    );
    return;
  }

  if (restoreCode) {
    if (!options.repo) {
      options.ui.notify(checkpointStorageMissingConversationMessage, "warning");
      return;
    }

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

    options.onCodeRestore?.(options.targetCp.beforeCommit);
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
