import type { CheckpointEntry, RepoManager } from "@ayulab/pi-checkpoint";
import { errorMessage, safeRestore } from "@ayulab/pi-checkpoint";

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
    options: { readonly summarize: boolean; readonly customInstructions?: string },
  ) => Promise<unknown>;
  readonly targetCp: CheckpointEntry;
  readonly latestCp: CheckpointEntry;
}

export async function runRestoreMode(options: RunRestoreModeOptions): Promise<void> {
  if (options.mode.includes("Never mind")) return;

  if (options.mode === "Summarize from here") {
    try {
      const custom = await options.ui.input(
        "Summary focus (optional, press Enter for default):",
        "",
      );
      await options.navigateTree(
        options.targetCp.userEntryId,
        custom ? { summarize: true, customInstructions: custom } : { summarize: true },
      );
      options.ui.notify("Summarized and restored conversation", "info");
      return;
    } catch (err) {
      options.ui.notify(`Rewind failed: ${errorMessage(err)}`, "error");
      return;
    }
  }

  const restoreCode = options.mode.includes("code");
  const restoreConversation = options.mode.includes("conversation");

  if (restoreCode && restoreConversation) {
    await safeRestore({
      repo: options.repo,
      ui: options.ui,
      navigateTree: options.navigateTree,
      targetCommit: options.targetCp.beforeCommit,
      dirtyBaseCommit: options.latestCp.afterCommit,
      targetLeafId: options.targetCp.userEntryId,
      dirtyMessage:
        "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.",
      failedPrefix: "Rewind failed",
      rollbackFailedPrefix: "Rewind failed and rollback also failed",
      successMessage: "Rewind completed",
    });
    return;
  }

  if (restoreCode) {
    const result = await options.repo.safeCheckout(
      options.targetCp.beforeCommit,
      options.latestCp.afterCommit,
    );

    if (!result.ok) {
      if (result.reason === "dirty") {
        options.ui.notify(
          "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.",
          "warning",
        );
      } else if (result.rollbackError) {
        options.ui.notify(
          `Rewind failed and rollback also failed: ${result.rollbackError}`,
          "error",
        );
      } else {
        options.ui.notify(`Rewind failed: ${result.error}`, "error");
      }
      return;
    }
  }

  if (restoreConversation) {
    try {
      await options.navigateTree(options.targetCp.userEntryId, { summarize: false });
    } catch (err) {
      options.ui.notify(`Conversation restore failed: ${errorMessage(err)}`, "error");
      return;
    }
  }

  options.ui.notify("Rewind completed", "info");
}
