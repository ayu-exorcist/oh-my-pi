import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  loadConfig,
  loadConfigFromFile,
  defaultConfig,
  RepoManager,
  filterCheckpointEntries,
  extractCheckpointData,
  createDefaultRepoProvider,
  cloneSessionCheckpointStorage,
  ensureSessionCheckpointStorage,
} from "@ayulab/pi-checkpoint";
import type { RepoProvider, CheckpointConfig, CheckpointEntry } from "@ayulab/pi-checkpoint";
import { extractPrompt, findLastUserEntry } from "./utils/prompt";
import { registerRewind } from "./commands/rewind";
import { AutoCheckpointProducer } from "./auto-checkpoint";

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

function createAutoCheckpointProducer(
  repo: RepoManager,
  config: CheckpointConfig,
): AutoCheckpointProducer {
  return new AutoCheckpointProducer({
    repo,
    exclude: config.exclude,
    createTurnId: randomUUID,
    now: () => new Date(),
  });
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

  const producers = new Map<string, AutoCheckpointProducer>();

  let config = loadConfig({});

  pi.on("session_start", async (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId();

    // Load merged config: global first, then project overrides.
    const globalConfig = loadConfigFromFile(path.join(os.homedir(), ".pi", "agent"));
    const projectConfig = loadConfigFromFile(path.join(ctx.cwd, ".pi"));
    config = mergeConfigs(globalConfig, projectConfig);

    if (event.reason === "fork") {
      if (!event.previousSessionFile) return;

      const storage = await cloneSessionCheckpointStorage({
        previousSessionFile: event.previousSessionFile,
        sessionFile,
        cwd: ctx.cwd,
      });

      if (!storage.ok) return;

      repos.setRepo(sessionId, storage.repo);
      producers.set(sessionId, createAutoCheckpointProducer(storage.repo, config));

      // Optionally restore code state to the fork point.
      if (config.restoreOnFork === "always") {
        const entries = ctx.sessionManager.getEntries();
        const lastUserEntry = findLastUserEntry(ctx.sessionManager.getBranch());
        if (lastUserEntry) {
          const cp = findCheckpointForEntryId(entries, lastUserEntry.id);
          if (cp) {
            await storage.repo.checkoutCommit(cp.beforeCommit);
          }
        }
      }
      return;
    }

    const storage = await ensureSessionCheckpointStorage({
      sessionFile,
      cwd: ctx.cwd,
      exclude: config.exclude,
    });
    repos.setRepo(sessionId, storage.repo);
    producers.set(sessionId, createAutoCheckpointProducer(storage.repo, config));
  });

  pi.on("turn_start", async (_event, ctx) => {
    const producer = producers.get(ctx.sessionManager.getSessionId());
    if (!config.enabled || !config.autoCheckpoint || !producer) return;

    const branch = ctx.sessionManager.getBranch();
    const leaf = findLastUserEntry(branch);
    if (!leaf) return;

    const result = await producer.turnStart({
      userEntryId: leaf.id,
      prompt: extractPrompt(leaf).slice(0, 60),
    });

    if (!result.ok && ctx.hasUI) {
      ctx.ui.notify(result.message, "warning");
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const producer = producers.get(ctx.sessionManager.getSessionId());
    if (!producer) return;

    const result = await producer.turnEnd();
    if (result.ok) {
      pi.appendEntry("pi-checkpoint", result.entry);
    }
  });

  registerRewind(pi, (sessionId) => repos.getRepo(sessionId));
}
