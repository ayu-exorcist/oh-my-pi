import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RepoManager, CheckpointEntry, FileChange } from "@ayulab/pi-checkpoint";
import { getCheckpointEntries } from "@ayulab/pi-checkpoint";
import { runRestoreMode } from "./restore-mode";

/** Render a single file change with ANSI colour codes for terminal display. */
export function formatChangeLine(change: FileChange): string {
  const added = `\x1b[32m+${change.added}\x1b[0m`;
  const removed = `\x1b[31m-${change.removed}\x1b[0m`;
  return `${change.path} ${added} ${removed}`;
}

/**
 * Build a multi-line display string for a checkpoint entry.
 *
 * Includes the prompt and per-file change stats so that the user can
 * see exactly what happened during that turn.
 */
export function buildCheckpointItem(cp: CheckpointEntry): string {
  if (cp.fileCount === 0) {
    return cp.prompt;
  }
  if (cp.fileChanges.length === 0) {
    return `${cp.prompt}\n   ${cp.fileCount} file${cp.fileCount > 1 ? "s" : ""} changed`;
  }

  const changeLines = cp.fileChanges.map((c) => `   ${formatChangeLine(c)}`).join("\n");
  return `${cp.prompt}\n${changeLines}`;
}

/**
 * Register the `/rewind` command.
 *
 * Presents an interactive list of checkpoints and supports five options:
 *   1. Restore code and conversation
 *   2. Restore conversation only
 *   3. Restore code only
 *   4. Summarize from here
 *   5. Never mind
 *
 * Dirty-guard: if the workspace has unsnapshotted changes, warns the user
 * before checking out an old commit. A safety commit is created before
 * checkout so that failures can be rolled back automatically.
 */
export function registerRewind(
  pi: ExtensionAPI,
  getRepo: (sessionId: string) => RepoManager | undefined,
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
      const cps = getCheckpointEntries(entries);
      if (cps.length === 0) {
        ctx.ui.notify("No checkpoints available", "warning");
        return;
      }

      const items = cps.map((cp) => buildCheckpointItem(cp));

      const selected = await ctx.ui.select("Rewind to checkpoint:", items);
      if (!selected) return;

      const idx = items.indexOf(selected);
      const targetCp = cps[idx];
      if (!targetCp) return;

      const modes = [
        "Restore code and conversation",
        "Restore conversation only",
        "Restore code",
        "Summarize from here",
        "Never mind",
      ];

      const mode = await ctx.ui.select("Restore mode:", modes);
      if (!mode) return;

      let latest = targetCp;
      for (const cp of cps) {
        latest = cp;
      }

      await runRestoreMode({
        mode,
        repo,
        ui: ctx.ui,
        navigateTree: ctx.navigateTree,
        targetCp,
        latestCp: latest,
      });
    },
  });
}
