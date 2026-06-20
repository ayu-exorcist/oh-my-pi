import { errorMessage } from "@ayulab/runtime-core";
import type { RepoManager } from "./repo-manager";

interface RestoreUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
}

export interface NavigateTreeOptions {
  readonly summarize?: boolean;
  readonly customInstructions?: string;
  readonly replaceInstructions?: boolean;
  readonly label?: string;
}

export interface NavigateTreeResult {
  readonly editorText?: string;
  readonly cancelled: boolean;
}

type NavigateTreeFnFalse = (
  entryId: string,
  options: { readonly summarize: false },
) => Promise<NavigateTreeResult>;

interface RestoreOptions {
  readonly repo: RepoManager;
  readonly ui: RestoreUi;
  readonly navigateTree: NavigateTreeFnFalse;
  readonly targetCommit: string;
  readonly dirtyBaseCommit: string | undefined;
  readonly targetLeafId: string;
  readonly dirtyMessage: string;
  readonly failedPrefix: string;
  readonly rollbackFailedPrefix: string;
  readonly successMessage: string;
}

export type RestoreResult = { readonly ok: true } | { readonly ok: false };

/**
 * Safely check out a commit and navigate the conversation tree.
 *
 * Handles dirty-worktree guard, checkout failure with rollback,
 * and conversation-tree navigation in one call.
 */
export async function safeRestore(options: RestoreOptions): Promise<RestoreResult> {
  const result = await options.repo.safeCheckout(options.targetCommit, options.dirtyBaseCommit);

  if (!result.ok) {
    if (result.reason === "dirty") {
      options.ui.notify(options.dirtyMessage, "warning");
      return { ok: false };
    }
    if (result.reason === "dirty-check-failed") {
      options.ui.notify(`Workspace cleanliness could not be verified: ${result.error}`, "error");
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
