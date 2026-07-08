import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getRepoDir } from "@ayulab/pi-checkpoint";
import path from "node:path";
import { CheckpointSelectorComponent, type SessionListProgress } from "./checkpoint-selector";
import { buildCheckpointSessions, deleteCheckpointStorage, fileExists } from "./checkpoint-storage";

async function openCheckpointSelector(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.ui.custom) {
    const sessions = await buildCheckpointSessions(ctx.cwd, "current");
    await ctx.ui.select(
      "Checkpoint Storage:",
      sessions.map((session) => session.name ?? session.firstMessage),
    );
    return;
  }

  const currentSessionFile = ctx.sessionManager.getSessionFile();
  const currentRepoDir = getRepoDir(currentSessionFile);
  const currentSelectorPath =
    currentSessionFile && (await fileExists(path.join(currentRepoDir, ".git")))
      ? currentRepoDir
      : (currentSessionFile ?? currentRepoDir);

  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    const selector = new CheckpointSelectorComponent({
      currentLoader: (onProgress?: SessionListProgress) =>
        buildCheckpointSessions(ctx.cwd, "current", onProgress),
      allLoader: (onProgress?: SessionListProgress) =>
        buildCheckpointSessions(ctx.cwd, "all", onProgress),
      deleteStorage: (session) =>
        deleteCheckpointStorage(session, ctx.sessionManager.getSessionFile()),
      currentSessionPath: currentSelectorPath,
      requestRender: () => tui.requestRender(),
      onClose: () => done(undefined),
      theme,
      keybindings,
    });

    return selector;
  });
}

export function registerCheckpointStorageCommand(pi: ExtensionAPI): void {
  pi.registerCommand("checkpoint", {
    description: "Manage checkpoint storage for the current directory",
    handler: async (_args, ctx) => {
      await openCheckpointSelector(ctx);
    },
  });
}
