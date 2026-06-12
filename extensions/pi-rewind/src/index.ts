import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  bindSessionRepo,
  getRepoDir,
  getCheckpointEntries,
} from "@ayulab/pi-checkpoint";
import { SessionStateMap } from "@ayulab/pi-checkpoint";
import type { RepoProvider, CheckpointConfig, CheckpointEntry } from "@ayulab/pi-checkpoint";
import { isRecord } from "@ayulab/runtime-core";
import { extractPrompt, findLastUserEntry } from "./utils/prompt";
import { findLatestBranchCheckpoint } from "./utils/branch-checkpoints";
import { registerRewind } from "./commands/rewind";
import { AutoCheckpointProducer } from "./auto-checkpoint";
import {
  getTreeEventRecord,
  isEntryWithId,
  isUserMessageEntry,
  toTreeEntryRecords,
  type TreeEntryRecord,
} from "./utils/tree-entry";

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
    restoreOnTree:
      project.restoreOnTree === defaultConfig.restoreOnTree
        ? global.restoreOnTree
        : project.restoreOnTree,
    exclude: arraysEqual(project.exclude, defaultConfig.exclude) ? global.exclude : project.exclude,
  };
}

/** Find the checkpoint that was created right before a given user entry. */
function findCheckpointForEntryId(
  entries: readonly unknown[],
  entryId: string,
): CheckpointEntry | undefined {
  const dataList = extractCheckpointData(entries);
  return filterCheckpointEntries(dataList).find((checkpoint) => checkpoint.userEntryId === entryId);
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

interface TreeRestoreIntent {
  readonly targetId: string;
  readonly mode: "Restore code and conversation" | "Restore conversation";
}

export function isForkIntentRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function isForkIntent(value: unknown): value is ForkIntent {
  if (!isForkIntentRecord(value)) return false;

  return (
    typeof value.entryId === "string" && (value.position === "before" || value.position === "at")
  );
}

export function getForkIntentPath(sessionFile: string | undefined): string {
  return path.join(getRepoDir(sessionFile), "fork-intent.json");
}

export async function writeForkIntent(
  sessionFile: string | undefined,
  intent: ForkIntent | undefined,
): Promise<void> {
  if (!sessionFile || !intent) return;

  const intentPath = getForkIntentPath(sessionFile);
  await mkdir(path.dirname(intentPath), { recursive: true });
  await writeFile(intentPath, JSON.stringify(intent), "utf8");
}

export async function readForkIntent(
  sessionFile: string | undefined,
): Promise<ForkIntent | undefined> {
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

function createSessionTaskQueue() {
  const queues = new SessionStateMap<Promise<void>>();

  return {
    delete(sessionId: string): void {
      queues.delete(sessionId);
    },
    run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
      const previous = queues.getOrUndefined(sessionId) ?? Promise.resolve();
      const next = previous.then(() => task());
      /* c8 ignore next 2 */
      queues.set(
        sessionId,
        next.then(
          () => undefined,
          () => undefined,
        ),
      );
      return next;
    },
  };
}

function findLatestCheckpoint(entries: readonly unknown[]): CheckpointEntry | undefined {
  let latest: CheckpointEntry | undefined;
  for (const checkpoint of filterCheckpointEntries(extractCheckpointData(entries))) {
    latest = checkpoint;
  }
  return latest;
}

function findEntryById(entries: readonly unknown[], entryId: string): TreeEntryRecord | undefined {
  return entries.find(
    (entry): entry is TreeEntryRecord => isEntryWithId(entry) && entry.id === entryId,
  );
}

function buildBranchToEntry(
  entries: readonly unknown[],
  leafId: string,
): readonly TreeEntryRecord[] {
  const byId = new Map<string, TreeEntryRecord>();
  for (const entry of entries) {
    if (isEntryWithId(entry)) {
      byId.set(entry.id, entry);
    }
  }

  const branch: TreeEntryRecord[] = [];
  let currentId: string | undefined = leafId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const current = byId.get(currentId);
    if (!current) break;
    branch.push(current);
    currentId = current.parentId ?? undefined;
  }

  return branch.reverse();
}

function resolveTreeTargetCommit(
  entries: readonly unknown[],
  branch: readonly TreeEntryRecord[],
  targetId: string | undefined,
): string | undefined {
  const targetEntry = targetId ? findEntryById(entries, targetId) : undefined;
  if (isUserMessageEntry(targetEntry)) {
    return findCheckpointForEntryId(entries, targetEntry.id)?.beforeCommit;
  }

  return findLatestBranchCheckpoint(entries, branch)?.afterCommit;
}

async function findCleanCheckpointCommit(
  repo: RepoManager,
  checkpoints: readonly CheckpointEntry[],
): Promise<string | undefined> {
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
    return undefined;
  }

  return undefined;
}

async function safeRestoreTreeCodeState(
  repo: RepoManager,
  targetCommit: string | undefined,
  dirtyBaseCommit: string | undefined,
  ui: ExtensionContext["ui"] | undefined,
): Promise<boolean> {
  if (!targetCommit) return true;

  const result = await repo.safeCheckout(targetCommit, dirtyBaseCommit);
  if (result.ok) return true;

  if (result.reason === "dirty") {
    ui?.notify(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before navigating the tree.",
      "warning",
    );
    return false;
  }

  if (result.rollbackError) {
    ui?.notify(
      `Tree file restore failed and rollback also failed: ${result.rollbackError}`,
      "error",
    );
    return false;
  }

  ui?.notify(`Tree file restore failed: ${result.error}`, "error");
  return false;
}

async function restoreForkCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  branch: readonly TreeEntryRecord[],
  selectedEntryId: string | undefined,
): Promise<void> {
  const selectedCp = selectedEntryId
    ? findCheckpointForEntryId(entries, selectedEntryId)
    : undefined;
  const targetCommit =
    selectedCp?.beforeCommit ?? findLatestBranchCheckpoint(entries, branch)?.afterCommit;
  if (targetCommit) {
    await repo.checkoutCommit(targetCommit);
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

  const producers = new SessionStateMap<AutoCheckpointProducer>();
  const sessionTasks = createSessionTaskQueue();
  const lastCheckpointTurnIds = new SessionStateMap<string>();
  const pendingTreeRestores = new SessionStateMap<TreeRestoreIntent>();
  const suppressedTreeRestores = new SessionStateMap<boolean>();

  function appendCheckpoint(sessionId: string, entry: CheckpointEntry): void {
    if (lastCheckpointTurnIds.getOrUndefined(sessionId) === entry.turnId) return;
    lastCheckpointTurnIds.set(sessionId, entry.turnId);
    pi.appendEntry("pi-checkpoint", entry);
  }

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
        await restoreForkCodeState(
          storage.repo,
          entries,
          ctx.sessionManager.getBranch(),
          forkIntent?.entryId,
        );
      }
      return;
    }

    const repo = await bindSessionRepo(sessionId, sessionFile, ctx.cwd, repos, {
      exclude: config.exclude,
    });
    const producer = createAutoCheckpointProducer(repo, config);
    producers.set(sessionId, producer);
    sessionTasks.delete(sessionId);
    lastCheckpointTurnIds.delete(sessionId);
    pendingTreeRestores.delete(sessionId);
    suppressedTreeRestores.delete(sessionId);

    if (event.reason === "resume" && config.restoreOnResume === "always") {
      const entries = ctx.sessionManager.getEntries();
      const targetCommit = resolveTreeTargetCommit(
        entries,
        ctx.sessionManager.getBranch(),
        undefined,
      );
      const dirtyBaseCommit = await findCleanCheckpointCommit(repo, getCheckpointEntries(entries));
      if (targetCommit && !dirtyBaseCommit) {
        ctx.ui.notify(
          "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before resuming checkpoint state.",
          "warning",
        );
        return;
      }
      await safeRestoreTreeCodeState(repo, targetCommit, dirtyBaseCommit, ctx.ui);
    }
  });

  async function startCheckpointForLatestUser(
    sessionId: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!config.enabled || !config.autoCheckpoint || !producer) return;

      const leaf = findLastUserEntry(ctx.sessionManager.getBranch());
      if (!leaf) return;

      const result = await producer.turnStart({
        userEntryId: leaf.id,
        prompt: extractPrompt(leaf).slice(0, 60),
      });

      if (result.ok) {
        for (const entry of result.entries) {
          appendCheckpoint(sessionId, entry);
        }
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(result.message, "warning");
      }
    });
  }

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const sessionId = ctx.sessionManager.getSessionId();
    await startCheckpointForLatestUser(sessionId, ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!producer) return;

      const leaf = findLastUserEntry(ctx.sessionManager.getBranch());
      if (!leaf) return;

      await producer.turnEnd({
        userEntryId: leaf.id,
        prompt: extractPrompt(leaf).slice(0, 60),
      });
    });
  });

  pi.on("agent_end", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!producer) return;

      const result = await producer.finalizeRun();
      if (result.ok) {
        appendCheckpoint(sessionId, result.entry);
      }
    });
  });

  pi.on("session_before_tree", async (event, ctx) => {
    const treeEvent = getTreeEventRecord(event);
    const targetId = treeEvent?.targetId;
    if (!targetId) return;

    const sessionId = ctx.sessionManager.getSessionId();
    if (suppressedTreeRestores.getOrUndefined(sessionId)) return;

    pendingTreeRestores.set(sessionId, { targetId, mode: "Restore conversation" });

    if (treeEvent.userWantsSummary !== false) return;

    if (config.restoreOnTree === "always") {
      pendingTreeRestores.set(sessionId, {
        targetId,
        mode: "Restore code and conversation",
      });
      return;
    }

    if (config.restoreOnTree === "ask") {
      if (!ctx.hasUI) return;

      const syncFiles = await ctx.ui.select("Sync files?", ["Yes", "No"]);
      if (syncFiles === "Yes") {
        pendingTreeRestores.set(sessionId, {
          targetId,
          mode: "Restore code and conversation",
        });
      }
      return;
    }

    pendingTreeRestores.delete(sessionId);
  });

  pi.on("session_tree", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (suppressedTreeRestores.getOrUndefined(sessionId)) {
      suppressedTreeRestores.delete(sessionId);
      pendingTreeRestores.delete(sessionId);
      return;
    }

    const restoreIntent = pendingTreeRestores.getOrUndefined(sessionId);
    pendingTreeRestores.delete(sessionId);
    if (restoreIntent?.mode === "Restore conversation") return;
    if (!restoreIntent && config.restoreOnTree !== "always") return;

    const repo = repos.getRepo(sessionId);
    if (!repo) return;

    const entries = ctx.sessionManager.getEntries();
    const treeEvent = getTreeEventRecord(event);
    const currentBranch = toTreeEntryRecords(ctx.sessionManager.getBranch());
    const oldLeafId = treeEvent?.oldLeafId;
    const oldBranch = oldLeafId ? buildBranchToEntry(entries, oldLeafId) : currentBranch;
    const targetId = restoreIntent?.targetId;
    const targetLeafId = targetId ?? treeEvent?.newLeafId;
    const targetBranch = targetLeafId ? buildBranchToEntry(entries, targetLeafId) : currentBranch;

    const dirtyBaseCommit =
      (await findCleanCheckpointCommit(repo, getCheckpointEntries(entries))) ??
      findLatestBranchCheckpoint(entries, oldBranch)?.afterCommit;

    await safeRestoreTreeCodeState(
      repo,
      resolveTreeTargetCommit(entries, targetBranch, targetId),
      dirtyBaseCommit,
      ctx.hasUI ? ctx.ui : undefined,
    );
  });

  registerRewind(
    pi,
    (sessionId) => repos.getRepo(sessionId),
    (sessionId) => {
      suppressedTreeRestores.set(sessionId, true);
    },
    (sessionId) => {
      suppressedTreeRestores.delete(sessionId);
    },
  );
}
