import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  loadConfig,
  loadConfigFromFile,
  defaultConfig,
  RepoManager,
  getRepoDir,
  getGitDir,
  getIndexPath,
  parseDiffStats,
  filterCheckpointEntries,
  extractCheckpointData,
  createDefaultRepoProvider,
  errorMessage,
} from "@ayulab/pi-checkpoint";
import type { RepoProvider, CheckpointConfig, CheckpointEntry } from "@ayulab/pi-checkpoint";
import { extractPrompt, findLastUserEntry } from "./utils/prompt";
import { registerRewind } from "./commands/rewind";

/** Deep-equal for string arrays used to detect whether exclude was overridden. */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Merge global and project-level checkpoint configs.
 *
 * Project values win, except for `exclude`: if the project config still
 * contains the default exclude list, fall back to the global list so that
 * users can define workspace-wide ignores in `~/.pi/agent/settings.json`.
 */
function mergeConfigs(global: CheckpointConfig, project: CheckpointConfig): CheckpointConfig {
  return {
    ...global,
    ...project,
    exclude: arraysEqual(project.exclude, defaultConfig.exclude) ? global.exclude : project.exclude,
  };
}

/** Find the checkpoint that was created right before a given user entry. */
function findCheckpointForEntryId(
  entries: readonly unknown[],
  entryId: string,
): CheckpointEntry | undefined {
  const dataList = extractCheckpointData(entries);
  return filterCheckpointEntries(dataList).find((c) => c.userEntryId === entryId);
}

/**
 * Pi extension entry point — sets up automatic per-turn checkpoints
 * and registers the `/rewind` command.
 *
 * @param pi - Extension API.
 * @param provider - Optional repo provider for testing. Defaults to a
 *   Map-backed adapter that binds repos per session id.
 */
export default function (pi: ExtensionAPI, provider?: RepoProvider) {
  const repos = provider ?? createDefaultRepoProvider();

  /** In-flight turn state captured between `turn_start` and `turn_end`. */
  let pendingTurnId: string | undefined;
  let pendingUserEntryId: string | undefined;
  let pendingBeforeCommit: string | undefined;
  let pendingPrompt = "";

  let config = loadConfig({});

  pi.on("session_start", async (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId();
    const repoDir = getRepoDir(sessionFile);
    const gitDir = getGitDir(repoDir);
    const indexFile = getIndexPath(repoDir);

    // Load merged config: global first, then project overrides.
    const globalConfig = loadConfigFromFile(path.join(os.homedir(), ".pi", "agent"));
    const projectConfig = loadConfigFromFile(path.join(ctx.cwd, ".pi"));
    config = mergeConfigs(globalConfig, projectConfig);

    if (event.reason === "fork") {
      if (!event.previousSessionFile) return;

      const srcDir = getRepoDir(event.previousSessionFile);
      const srcExists = await fs
        .access(srcDir)
        .then(() => true)
        .catch(() => false);

      if (!srcExists) return;

      const dstExists = await fs
        .access(gitDir)
        .then(() => true)
        .catch(() => false);

      if (dstExists) return;

      await fs.mkdir(repoDir, { recursive: true });
      await RepoManager.cloneFrom(getGitDir(srcDir), gitDir);

      const repo = new RepoManager(gitDir, indexFile, ctx.cwd);
      repos.setRepo(sessionId, repo);

      // Optionally restore code state to the fork point.
      if (config.restoreOnFork === "always") {
        const entries = ctx.sessionManager.getEntries();
        const lastUserEntry = findLastUserEntry(ctx.sessionManager.getBranch());
        if (lastUserEntry) {
          const cp = findCheckpointForEntryId(entries, lastUserEntry.id);
          if (cp) {
            await repo.checkoutCommit(cp.beforeCommit);
          }
        }
      }
      return;
    }

    const repo = new RepoManager(gitDir, indexFile, ctx.cwd);
    repos.setRepo(sessionId, repo);

    const gitExists = await fs
      .access(gitDir)
      .then(() => true)
      .catch(() => false);

    // Initialise the bare repo on first use.
    if (!gitExists) {
      await repo.init();
      await repo.setExclude(config.exclude);
    }
  });

  pi.on("turn_start", async (_event, ctx) => {
    const repo = repos.getRepo(ctx.sessionManager.getSessionId());
    if (!config.enabled || !config.autoCheckpoint || !repo) return;

    const branch = ctx.sessionManager.getBranch();
    const leaf = findLastUserEntry(branch);
    if (!leaf) return;

    // Snapshot the workspace *before* the agent starts modifying files.
    pendingTurnId = randomUUID();
    pendingUserEntryId = leaf.id;
    pendingPrompt = extractPrompt(leaf).slice(0, 60);

    try {
      await repo.ensureReady(config.exclude);
      pendingBeforeCommit = await repo.checkpoint(leaf.id);
    } catch (err) {
      if (ctx.hasUI) {
        ctx.ui.notify(`Checkpoint failed: ${errorMessage(err)}`, "warning");
      }
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const repo = repos.getRepo(ctx.sessionManager.getSessionId());
    if (!pendingTurnId || !pendingUserEntryId || !pendingBeforeCommit || !repo) return;

    try {
      await repo.stageAll();
      const stdout = await repo.diffAgainst(pendingBeforeCommit);
      const parsed = parseDiffStats(stdout);

      // If nothing changed, reuse the before commit to keep history clean.
      const afterCommit =
        parsed.length > 0 ? await repo.checkpoint(pendingUserEntryId) : pendingBeforeCommit;

      // Persist checkpoint metadata as a custom session entry.
      pi.appendEntry("pi-checkpoint", {
        v: 2,
        kind: "checkpoint",
        turnId: pendingTurnId,
        userEntryId: pendingUserEntryId,
        beforeCommit: pendingBeforeCommit,
        afterCommit,
        prompt: pendingPrompt,
        fileCount: parsed.length,
        fileChanges: parsed,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Silently skip if diff fails at turn end
    }

    pendingTurnId = undefined;
    pendingUserEntryId = undefined;
    pendingBeforeCommit = undefined;
    pendingPrompt = "";
  });

  registerRewind(pi, (sessionId) => repos.getRepo(sessionId));
}
