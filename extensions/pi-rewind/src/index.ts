import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  getRepoDir,
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

interface ForkIntent {
  readonly entryId: string;
  readonly position: "before" | "at";
}

function isForkIntentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isForkIntent(value: unknown): value is ForkIntent {
  if (!isForkIntentRecord(value)) return false;

  return (
    typeof value.entryId === "string" && (value.position === "before" || value.position === "at")
  );
}

function getForkIntentPath(sessionFile: string | undefined): string {
  return path.join(getRepoDir(sessionFile), "fork-intent.json");
}

async function writeForkIntent(
  sessionFile: string | undefined,
  intent: ForkIntent | undefined,
): Promise<void> {
  if (!sessionFile || !intent) return;

  const intentPath = getForkIntentPath(sessionFile);
  await mkdir(path.dirname(intentPath), { recursive: true });
  await writeFile(intentPath, JSON.stringify(intent), "utf8");
}

async function readForkIntent(sessionFile: string | undefined): Promise<ForkIntent | undefined> {
  if (!sessionFile) return undefined;

  try {
    const intentPath = getForkIntentPath(sessionFile);
    const raw = await readFile(intentPath, "utf8");
    await rm(intentPath, { force: true });
    const parsed: unknown = JSON.parse(raw);
    return isForkIntent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findLatestCheckpoint(entries: readonly unknown[]): CheckpointEntry | undefined {
  let latest: CheckpointEntry | undefined;
  for (const cp of filterCheckpointEntries(extractCheckpointData(entries))) {
    latest = cp;
  }
  return latest;
}

async function restoreForkCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  branch: SessionEntry[],
): Promise<void> {
  const lastUserEntry = findLastUserEntry(branch);
  if (!lastUserEntry) return;

  const cp = findCheckpointForEntryId(entries, lastUserEntry.id);
  if (cp) {
    await repo.checkoutCommit(cp.beforeCommit);
  }
}

async function restoreCloneCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  selectedEntryId: string,
): Promise<void> {
  const targetCp =
    findCheckpointForEntryId(entries, selectedEntryId) ?? findLatestCheckpoint(entries);
  if (targetCp) {
    await repo.checkoutCommit(targetCp.afterCommit);
  }
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
  let pendingForkIntent: ForkIntent | undefined;

  pi.on("session_before_fork", async (event) => {
    pendingForkIntent = {
      entryId: event.entryId,
      position: event.position,
    };
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "fork") {
      await writeForkIntent(event.targetSessionFile, pendingForkIntent);
    }
    pendingForkIntent = undefined;
  });

  pi.on("session_start", async (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId();

    // Load merged config: global first, then project overrides.
    const globalConfig = loadConfigFromFile(path.join(os.homedir(), ".pi", "agent"));
    const projectConfig = loadConfigFromFile(path.join(ctx.cwd, ".pi"));
    config = mergeConfigs(globalConfig, projectConfig);

    if (event.reason === "fork") {
      if (!event.previousSessionFile) return;

      const forkIntent = await readForkIntent(sessionFile);
      const storage = await cloneSessionCheckpointStorage({
        previousSessionFile: event.previousSessionFile,
        sessionFile,
        cwd: ctx.cwd,
      });

      if (!storage.ok) return;

      repos.setRepo(sessionId, storage.repo);
      producers.set(sessionId, createAutoCheckpointProducer(storage.repo, config));

      const entries = ctx.sessionManager.getEntries();
      if (forkIntent?.position === "at") {
        if (config.restoreOnClone === "always") {
          await restoreCloneCodeState(storage.repo, entries, forkIntent.entryId);
        }
      } else if (config.restoreOnFork === "always") {
        await restoreForkCodeState(storage.repo, entries, ctx.sessionManager.getBranch());
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
