import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCheckpointEntries } from "@ayulab/pi-checkpoint";
import type { RepoManager, CheckpointEntry, FileChange } from "@ayulab/pi-checkpoint";
import { hasItems } from "@ayulab/runtime-core";
import { getBranchCheckpointEntries } from "../utils/branch-checkpoints";
import { runRestoreMode } from "./restore-mode";
import { isCheckpointCustomEntry, isEntryWithId, isUserMessageEntry } from "../utils/tree-entry";

async function findCleanDirtyBaseCommit(
  repo: RepoManager,
  checkpoints: readonly CheckpointEntry[],
  fallbackCommit: string,
): Promise<string> {
  const commits = new Set<string>();
  for (const cp of [...checkpoints].reverse()) {
    commits.add(cp.afterCommit);
    commits.add(cp.beforeCommit);
  }

  try {
    await repo.stageAll();
    for (const commit of commits) {
      const diff = await repo.diffAgainst(commit);
      if (diff.trim().length === 0) return commit;
    }
  } catch {
    return fallbackCommit;
  }

  return fallbackCommit;
}

export function findConversationEntryIdForCheckpoint(
  branch: readonly unknown[],
  userEntryId: string,
): string {
  const userIndex = branch.findIndex(
    (entry) => isUserMessageEntry(entry) && entry.id === userEntryId,
  );
  if (userIndex < 0) return userEntryId;

  let conversationEntryId = userEntryId;
  for (const entry of branch.slice(userIndex + 1)) {
    if (isUserMessageEntry(entry)) break;
    if (isEntryWithId(entry) && !isCheckpointCustomEntry(entry)) {
      conversationEntryId = entry.id;
    }
  }

  return conversationEntryId;
}

/** Render a single file change with ANSI colour codes for terminal display. */
export function formatChangeLine(change: FileChange): string {
  return `\x1b[38;5;245m${change.path} \x1b[38;5;2m+${change.added}\x1b[38;5;245m \x1b[38;5;1m-${change.removed}\x1b[0m`;
}

/**
 * Build a multi-line display string for a checkpoint entry.
 *
 * Includes the prompt and per-file change stats so that the user can
 * see exactly what happened during that turn. Blank lines deliberately
 * add vertical breathing room in Pi's select dialog.
 */
export function buildCheckpointItem(cp: CheckpointEntry): string {
  const header = cp.prompt;
  if (cp.fileCount === 0) {
    return `${header}\n   \x1b[38;5;245mNo code changes\x1b[0m\n`;
  }
  if (cp.fileChanges.length === 0) {
    return `${header}\n   \x1b[38;5;245m${cp.fileCount} file${cp.fileCount > 1 ? "s" : ""} changed\x1b[0m\n`;
  }

  if (cp.fileChanges.length === 1) {
    const change = cp.fileChanges[0];
    return `${header}\n   ${change ? formatChangeLine(change) : ""}\n`;
  }

  const totalAdded = cp.fileChanges.reduce((sum, change) => sum + change.added, 0);
  const totalRemoved = cp.fileChanges.reduce((sum, change) => sum + change.removed, 0);
  return `${header}\n   \x1b[38;5;245m${cp.fileCount} files changed  \x1b[38;5;2m+${totalAdded}\x1b[38;5;245m \x1b[38;5;1m-${totalRemoved}\x1b[0m\n`;
}

/**
 * Register the `/rewind` command.
 *
 * Presents an interactive list of checkpoints. When the active checkpoint
 * list contains file changes, it supports three options:
 *   1. Restore code and conversation
 *   2. Restore conversation
 *   3. Restore code
 *
 * If the checkpoint list has no file changes, code restore options are hidden.
 *
 * Dirty-guard: if the workspace has unsnapshotted changes, warns the user
 * before checking out an old commit. A safety commit is created before
 * checkout so that failures can be rolled back automatically.
 */
export function registerRewind(
  pi: ExtensionAPI,
  getRepo: (sessionId: string) => RepoManager | undefined,
  suppressTreeRestore: (sessionId: string) => void = () => undefined,
  clearTreeRestoreSuppression: (sessionId: string) => void = () => undefined,
) {
  pi.registerCommand("rewind", {
    description: "Rewind files to a previous checkpoint",
    handler: async (_args, ctx) => {
      const repo = getRepo(ctx.sessionManager.getSessionId());
      if (!repo) {
        ctx.ui.notify("Checkpoint extension not ready", "warning");
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      const branch = ctx.sessionManager.getBranch();
      const branchCps = getBranchCheckpointEntries(entries, branch);
      const cps = [...branchCps].reverse();
      if (!hasItems(cps)) {
        ctx.ui.notify("No checkpoints available", "warning");
        return;
      }

      const currentItem = "(current)\n";
      const items = [currentItem, ...cps.map((cp) => buildCheckpointItem(cp))];

      const selected = await ctx.ui.select("Rewind to checkpoint:", items);
      if (!selected) return;

      const idx = items.indexOf(selected);
      const targetCp = cps[idx - 1];
      if (!targetCp) return;

      const hasFileChanges = cps.some((cp) => cp.fileCount > 0);
      const modes = hasFileChanges
        ? ["Restore code and conversation", "Restore conversation", "Restore code"]
        : ["Restore conversation"];

      const mode = await ctx.ui.select("Restore mode:", modes);
      if (!mode) return;

      const latest = cps[0];
      const restoresCode = mode === "Restore code" || mode === "Restore code and conversation";
      const dirtyBaseCommit = restoresCode
        ? await findCleanDirtyBaseCommit(repo, getCheckpointEntries(entries), latest.afterCommit)
        : latest.afterCommit;

      const sessionId = ctx.sessionManager.getSessionId();
      await runRestoreMode({
        mode,
        repo,
        ui: ctx.ui,
        navigateTree: async (entryId, options) => {
          suppressTreeRestore(sessionId);
          try {
            return await ctx.navigateTree(entryId, options);
          } finally {
            clearTreeRestoreSuppression(sessionId);
          }
        },
        targetCp,
        latestCp: latest,
        conversationEntryId: targetCp.userEntryId,
        dirtyBaseCommit,
      });
    },
  });
}
