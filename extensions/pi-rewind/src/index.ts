import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  loadConfig,
  RepoManager,
  filterCheckpointEntries,
  extractCheckpointData,
  createDefaultRepoProvider,
  safeCloneSessionCheckpointStorage,
  bindSessionRepo,
  getRepoDir,
  getCheckpointEntries,
  readCheckpointStorageManifest,
  writeCheckpointStorageManifest,
  resolveSessionCheckpointStorage,
} from "@ayulab/pi-checkpoint";
import { SessionStateMap } from "@ayulab/pi-checkpoint";
import type { RepoProvider, CheckpointConfig, CheckpointEntry } from "@ayulab/pi-checkpoint";
import { errorMessage, isRecord } from "@ayulab/runtime-core";
import { extractFirstUserPrompt, extractPrompt, findLastUserEntry } from "./utils/prompt";
import { findLatestBranchCheckpoint } from "./utils/branch-checkpoints";
import { registerCheckpointStorageCommand } from "./commands/checkpoint";
import { registerRewind } from "./commands/rewind";
import { AutoCheckpointProducer } from "./auto-checkpoint";
import {
  getTreeEventRecord,
  isEntryWithId,
  isUserMessageEntry,
  toTreeEntryRecords,
  type TreeEntryRecord,
} from "./utils/tree-entry";

type TreeRestoreMode = "always" | "ask" | "never";

const CODE_RESTORE_WARNING_WIDGET_ID = "pi-rewind-code-restore-warning";
const CHECKPOINT_SESSION_STORAGE_MISSING_MESSAGE =
  "Checkpoint storage for this session is missing. File restore for existing checkpoints is unavailable.";
const CHECKPOINT_STORAGE_MISSING_MESSAGE =
  "Files were not restored because checkpoint storage for this session is missing.";
const CHECKPOINT_TARGET_MISSING_MESSAGE =
  "Files were not restored because the selected checkpoint is not present in checkpoint storage.";

function mergeSettingsRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    if (isRecord(baseValue) && isRecord(overrideValue)) {
      merged[key] = mergeSettingsRecords(baseValue, overrideValue);
      continue;
    }
    merged[key] = overrideValue;
  }
  return merged;
}

async function readSettingsRecord(configDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(configDir, "settings.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {};
    }
    if (isRecord(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function resolveTreeRestoreMode(settings: Record<string, unknown>): TreeRestoreMode {
  const ayu = settings.ayu;
  if (!isRecord(ayu)) return "ask";
  const rewind = ayu.rewind;
  if (!isRecord(rewind)) return "ask";
  const restoreOnTree = rewind.restoreOnTree;
  return restoreOnTree === "always" || restoreOnTree === "ask" || restoreOnTree === "never"
    ? restoreOnTree
    : "ask";
}

function normalizeSessionTitle(prompt: string | undefined): string {
  const collapsed = prompt?.replace(/\s+/g, " ").trim() ?? "";
  return collapsed.length > 0 ? collapsed : "Untitled session";
}

function toMaxFileBytes(config: CheckpointConfig): number | undefined {
  return typeof config.maxFileMB === "number"
    ? Math.max(1, Math.floor(config.maxFileMB * 1024 * 1024))
    : undefined;
}

function configureRepo(repo: RepoManager, config: CheckpointConfig): void {
  repo.setMaxFileBytes(toMaxFileBytes(config));
}

async function syncCheckpointStorageManifest(
  sessionFile: string | undefined,
  sessionId: string,
  cwd: string,
  entries: readonly SessionEntry[],
  fallbackPrompt?: string,
): Promise<void> {
  if (!sessionFile) return;

  const repoDir = getRepoDir(sessionFile);
  const existing = await readCheckpointStorageManifest(repoDir);
  const now = new Date().toISOString();
  const firstUserMessage = normalizeSessionTitle(
    existing?.firstUserMessage || fallbackPrompt || extractFirstUserPrompt(entries),
  );

  await writeCheckpointStorageManifest(repoDir, {
    version: 1,
    sessionId,
    sessionFile,
    cwd,
    firstUserMessage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

function notifySafeCheckoutFailure(
  ui: ExtensionContext["ui"] | undefined,
  result: Exclude<Awaited<ReturnType<RepoManager["safeCheckout"]>>, { readonly ok: true }>,
  dirtyMessage: string,
  dirtyCheckFailedMessage: string,
  failedPrefix: string,
  rollbackFailedPrefix: string,
): void {
  if (!ui) return;

  if (result.reason === "storage-missing") {
    ui.notify(CHECKPOINT_STORAGE_MISSING_MESSAGE, "warning");
    return;
  }

  if (result.reason === "target-missing") {
    ui.notify(CHECKPOINT_TARGET_MISSING_MESSAGE, "warning");
    return;
  }

  if (result.reason === "dirty") {
    ui.notify(result.message ? `${dirtyMessage}\n${result.message}` : dirtyMessage, "warning");
    return;
  }

  if (result.reason === "dirty-check-failed") {
    ui.notify(dirtyCheckFailedMessage, "warning");
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

type RestoreRepoResult =
  | { readonly ok: true; readonly repo: RepoManager }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "unusable"; readonly message: string };

function showCodeRestoreWarning(ui: ExtensionContext["ui"] | undefined, message: string): void {
  ui?.setWidget(CODE_RESTORE_WARNING_WIDGET_ID, (_tui, theme) => {
    return new Text(theme.fg("warning", `Warning: ${message}`), 0, 0);
  });
}

function clearCodeRestoreWarning(ui: ExtensionContext["ui"] | undefined): void {
  ui?.setWidget(CODE_RESTORE_WARNING_WIDGET_ID, undefined);
}

function notifyUnusableResumeStorage(
  ui: ExtensionContext["ui"] | undefined,
  message: string,
): void {
  ui?.notify(`Checkpoint storage could not be prepared for resume restore: ${message}`, "error");
}

function checkpointHasFileChanges(checkpoint: CheckpointEntry): boolean {
  return checkpoint.fileCount > 0 || checkpoint.fileChanges.length > 0;
}

function hasCheckpointFileChanges(entries: readonly unknown[]): boolean {
  return getCheckpointEntries(entries).some(checkpointHasFileChanges);
}

function rememberCheckpointFileChanges(
  state: SessionStateMap<boolean>,
  sessionId: string,
  entries: readonly unknown[],
): void {
  const checkpoints = filterCheckpointEntries(entries);
  const hasFileChanges = checkpoints.some(checkpointHasFileChanges);
  state.set(sessionId, state.getOrUndefined(sessionId) === true || hasFileChanges);
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
    return await repo.withLock(async () => {
      await repo.stageAll();
      for (const commit of commits) {
        const diff = await repo.diffAgainst(commit);
        if (diff.trim().length === 0) return commit;
      }
      return undefined;
    });
  } catch {
    return undefined;
  }
}

async function safeRestoreTreeCodeState(
  repo: RepoManager,
  targetCommit: string | undefined,
  dirtyBaseCommit: string | undefined,
  ui: ExtensionContext["ui"] | undefined,
): Promise<boolean> {
  if (!targetCommit) return true;

  const result =
    dirtyBaseCommit === undefined
      ? await repo.safeCheckout(targetCommit)
      : await repo.safeCheckout(targetCommit, dirtyBaseCommit);
  if (result.ok) return true;

  if (result.reason === "storage-missing") {
    showCodeRestoreWarning(ui, CHECKPOINT_STORAGE_MISSING_MESSAGE);
    return false;
  }

  if (result.reason === "target-missing") {
    showCodeRestoreWarning(ui, CHECKPOINT_TARGET_MISSING_MESSAGE);
    return false;
  }

  notifySafeCheckoutFailure(
    ui,
    result,
    "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before navigating the tree.",
    "Could not verify the workspace is clean. Clean up workspace changes before navigating the tree.",
    "Tree file restore failed",
    "Tree file restore failed and rollback also failed",
  );
  return false;
}

async function restoreForkCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  branch: readonly TreeEntryRecord[],
  selectedEntryId: string | undefined,
  ui: ExtensionContext["ui"] | undefined,
): Promise<void> {
  const selectedCp = selectedEntryId
    ? findCheckpointForEntryId(entries, selectedEntryId)
    : undefined;
  const targetCommit =
    selectedCp?.beforeCommit ?? findLatestBranchCheckpoint(entries, branch)?.afterCommit;
  if (!targetCommit) return;

  const result = await repo.safeCheckout(targetCommit);
  if (result.ok) return;

  notifySafeCheckoutFailure(
    ui,
    result,
    "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before restoring fork files.",
    "Could not verify the workspace is clean. Clean up workspace changes before restoring fork files.",
    "Fork file restore failed",
    "Fork file restore failed and rollback also failed",
  );
}

async function restoreCloneCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  selectedEntryId: string,
  ui: ExtensionContext["ui"] | undefined,
): Promise<void> {
  const targetCp =
    findCheckpointForEntryId(entries, selectedEntryId) ?? findLatestCheckpoint(entries);
  if (!targetCp) return;

  const result = await repo.safeCheckout(targetCp.afterCommit);
  if (result.ok) return;

  notifySafeCheckoutFailure(
    ui,
    result,
    "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before restoring cloned files.",
    "Could not verify the workspace is clean. Clean up workspace changes before restoring cloned files.",
    "Clone file restore failed",
    "Clone file restore failed and rollback also failed",
  );
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
  const sessionHasCheckpointFileChanges = new SessionStateMap<boolean>();
  const treeRestoreNotifiers = new SessionStateMap<ExtensionContext["ui"] | undefined>();
  const sessionNotifiers = new SessionStateMap<ExtensionContext["ui"] | undefined>();
  const sessionConfigs = new SessionStateMap<CheckpointConfig>();
  const sessionTreeRestoreModes = new SessionStateMap<TreeRestoreMode>();
  const sessionFiles = new SessionStateMap<string | undefined>();
  const sessionCwds = new SessionStateMap<string>();

  function getSessionConfig(sessionId: string): CheckpointConfig {
    return sessionConfigs.getOrUndefined(sessionId) ?? loadConfig({});
  }

  function getSessionTreeRestoreMode(sessionId: string): TreeRestoreMode {
    return sessionTreeRestoreModes.getOrUndefined(sessionId) ?? "ask";
  }

  function resetSessionRuntimeState(sessionId: string, entries: readonly unknown[]): void {
    producers.delete(sessionId);
    sessionTasks.delete(sessionId);
    lastCheckpointTurnIds.delete(sessionId);
    pendingTreeRestores.delete(sessionId);
    treeRestoreNotifiers.delete(sessionId);
    suppressedTreeRestores.delete(sessionId);
    sessionHasCheckpointFileChanges.set(sessionId, hasCheckpointFileChanges(entries));
  }

  async function getOrCreateAutoCheckpointProducer(
    sessionId: string,
    ctx: ExtensionContext,
    config: CheckpointConfig,
  ): Promise<AutoCheckpointProducer | undefined> {
    const existing = producers.getOrUndefined(sessionId);
    if (existing) return existing;
    if (!config.enabled || !config.autoCheckpoint) return undefined;

    const repo = await bindSessionRepo(
      sessionId,
      ctx.sessionManager.getSessionFile(),
      ctx.cwd,
      repos,
      { exclude: config.exclude },
    );
    configureRepo(repo, config);

    const producer = createAutoCheckpointProducer(repo, config);
    producers.set(sessionId, producer);
    return producer;
  }

  async function resolveRepoForRestore(
    sessionId: string,
    sessionFile: string | undefined,
    cwd: string,
    config: CheckpointConfig,
  ): Promise<RestoreRepoResult> {
    const storage = await resolveSessionCheckpointStorage({ sessionFile, cwd });
    if (!storage.ok) return { ok: false, reason: "not-found" };

    const repo = await bindSessionRepo(sessionId, sessionFile, cwd, repos);
    if (!repo) return { ok: false, reason: "not-found" };

    configureRepo(repo, config);
    try {
      await repo.lockedSetExclude(config.exclude);
    } catch (error) {
      return { ok: false, reason: "unusable", message: errorMessage(error) };
    }

    return { ok: true, repo };
  }

  async function appendCheckpoint(
    sessionId: string,
    sessionFile: string | undefined,
    cwd: string,
    entries: readonly SessionEntry[],
    entry: CheckpointEntry,
  ): Promise<void> {
    if (lastCheckpointTurnIds.getOrUndefined(sessionId) === entry.turnId) return;
    lastCheckpointTurnIds.set(sessionId, entry.turnId);
    rememberCheckpointFileChanges(sessionHasCheckpointFileChanges, sessionId, [entry]);
    pi.appendEntry("pi-checkpoint", entry);
    await syncCheckpointStorageManifest(sessionFile, sessionId, cwd, entries, entry.prompt);
  }

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

    // Merge raw settings first so project files inherit missing values from global settings
    // before the checkpoint defaults are applied.
    const globalSettings = await readSettingsRecord(path.join(os.homedir(), ".pi", "agent"));
    const projectSettings = await readSettingsRecord(path.join(ctx.cwd, ".pi"));
    const mergedSettings = mergeSettingsRecords(globalSettings, projectSettings);
    const baseConfig = loadConfig(mergedSettings);
    const treeRestoreMode = resolveTreeRestoreMode(mergedSettings);
    const config: CheckpointConfig = {
      ...baseConfig,
      restoreOnTree: treeRestoreMode !== "never",
    };
    sessionConfigs.set(sessionId, config);
    sessionTreeRestoreModes.set(sessionId, treeRestoreMode);
    sessionFiles.set(sessionId, sessionFile);
    sessionCwds.set(sessionId, ctx.cwd);
    sessionNotifiers.set(sessionId, ctx.hasUI ? ctx.ui : undefined);
    clearCodeRestoreWarning(ctx.hasUI ? ctx.ui : undefined);

    if (event.reason === "fork") {
      const entries = ctx.sessionManager.getEntries();
      resetSessionRuntimeState(sessionId, entries);
      const forkIntent = await readForkIntent(sessionFile);
      if (!event.previousSessionFile) return;

      const storage = await safeCloneSessionCheckpointStorage({
        previousSessionFile: event.previousSessionFile,
        sessionFile,
        cwd: ctx.cwd,
        exclude: config.exclude,
      });

      if (!storage.ok) return;

      configureRepo(storage.repo, config);
      repos.setRepo(sessionId, storage.repo);
      producers.set(sessionId, createAutoCheckpointProducer(storage.repo, config));

      await syncCheckpointStorageManifest(sessionFile, sessionId, ctx.cwd, entries);
      if (forkIntent?.position === "at") {
        if (config.restoreOnClone) {
          await restoreCloneCodeState(
            storage.repo,
            entries,
            forkIntent.entryId,
            ctx.hasUI ? ctx.ui : undefined,
          );
        }
      } else if (config.restoreOnFork) {
        await restoreForkCodeState(
          storage.repo,
          entries,
          ctx.sessionManager.getBranch(),
          forkIntent?.entryId,
          ctx.hasUI ? ctx.ui : undefined,
        );
      }
      return;
    }

    const sessionEntries = ctx.sessionManager.getEntries();
    resetSessionRuntimeState(sessionId, sessionEntries);

    if (event.reason === "resume" || event.reason === "startup") {
      const storage = await resolveSessionCheckpointStorage({ sessionFile, cwd: ctx.cwd });
      if (!storage.ok && hasCheckpointFileChanges(sessionEntries)) {
        showCodeRestoreWarning(
          ctx.hasUI ? ctx.ui : undefined,
          CHECKPOINT_SESSION_STORAGE_MISSING_MESSAGE,
        );
      }
    }

    if ((event.reason === "resume" || event.reason === "startup") && config.restoreOnResume) {
      const entries = ctx.sessionManager.getEntries();
      const targetCommit = resolveTreeTargetCommit(
        entries,
        ctx.sessionManager.getBranch(),
        undefined,
      );
      if (!targetCommit) return;

      const restoreRepo = await resolveRepoForRestore(sessionId, sessionFile, ctx.cwd, config);
      if (!restoreRepo.ok) {
        if (restoreRepo.reason === "not-found") {
          showCodeRestoreWarning(
            ctx.hasUI ? ctx.ui : undefined,
            CHECKPOINT_STORAGE_MISSING_MESSAGE,
          );
        } else {
          notifyUnusableResumeStorage(ctx.hasUI ? ctx.ui : undefined, restoreRepo.message);
        }
        return;
      }

      await syncCheckpointStorageManifest(sessionFile, sessionId, ctx.cwd, sessionEntries);

      const result = await restoreRepo.repo.safeCheckout(targetCommit);
      if (!result.ok) {
        notifySafeCheckoutFailure(
          ctx.hasUI ? ctx.ui : undefined,
          result,
          "Skipped file restore because the workspace has changes that are not captured by this session's checkpoint history.",
          "Could not verify the workspace is clean. Clean up workspace changes before resuming checkpoint state.",
          "Resume file restore failed",
          "Resume file restore failed and rollback also failed",
        );
      }
    }
  });

  async function finalizeCheckpointForSession(ctx: ExtensionContext): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!producer) return;

      const result = await producer.finalizeRun();
      if (result.ok) {
        await appendCheckpoint(
          sessionId,
          ctx.sessionManager.getSessionFile(),
          ctx.cwd,
          ctx.sessionManager.getEntries(),
          result.entry,
        );
      }
    });
  }

  async function startCheckpointForLatestUser(
    sessionId: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    await sessionTasks.run(sessionId, async () => {
      const config = getSessionConfig(sessionId);
      if (!config.enabled || !config.autoCheckpoint) return;

      const leaf = findLastUserEntry(ctx.sessionManager.getBranch());
      if (!leaf) return;

      const producer = await getOrCreateAutoCheckpointProducer(sessionId, ctx, config);
      if (!producer) return;

      const result = await producer.turnStart({
        userEntryId: leaf.id,
        prompt: extractPrompt(leaf),
      });

      if (result.ok) {
        for (const entry of result.entries) {
          await appendCheckpoint(
            sessionId,
            ctx.sessionManager.getSessionFile(),
            ctx.cwd,
            ctx.sessionManager.getEntries(),
            entry,
          );
        }
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(result.message, "warning");
      }
    });
  }

  pi.on("input", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    clearCodeRestoreWarning(ctx.hasUI ? ctx.ui : sessionNotifiers.getOrUndefined(sessionId));
  });

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
        prompt: extractPrompt(leaf),
      });
    });
  });

  pi.on("agent_end", async (_event, ctx) => {
    await finalizeCheckpointForSession(ctx);
  });

  pi.on("session_before_tree", async (event, ctx) => {
    const treeEvent = getTreeEventRecord(event);
    const targetId = treeEvent?.targetId;
    if (!targetId) return;

    const sessionId = ctx.sessionManager.getSessionId();
    const treeRestoreMode = getSessionTreeRestoreMode(sessionId);
    if (suppressedTreeRestores.getOrUndefined(sessionId)) return;

    pendingTreeRestores.set(sessionId, { targetId, mode: "Restore conversation" });
    treeRestoreNotifiers.delete(sessionId);

    // Summarise or Summarize with custom prompt → behave like native /tree
    // (conversation-only navigation, no file restore).
    // When userWantsSummary is undefined (e.g. legacy pi-coding-agent),
    // treat it as "not explicitly requesting summary" so that restoreOnTree
    // settings can still apply.
    if (treeEvent.userWantsSummary === true) return;

    await finalizeCheckpointForSession(ctx);
    const hasKnownFileChanges =
      sessionHasCheckpointFileChanges.getOrUndefined(sessionId) === true ||
      hasCheckpointFileChanges(ctx.sessionManager.getEntries());
    sessionHasCheckpointFileChanges.set(sessionId, hasKnownFileChanges);

    if (treeRestoreMode === "always") {
      const restoreUi = ctx.hasUI ? ctx.ui : sessionNotifiers.getOrUndefined(sessionId);
      pendingTreeRestores.set(sessionId, {
        targetId,
        mode: "Restore code and conversation",
      });
      treeRestoreNotifiers.set(sessionId, restoreUi);
      return;
    }

    if (treeRestoreMode === "ask") {
      if (!ctx.hasUI || !hasKnownFileChanges) return;

      const syncFiles = await ctx.ui.select("Sync files?", ["Yes", "No"]);
      if (syncFiles === "Yes") {
        pendingTreeRestores.set(sessionId, {
          targetId,
          mode: "Restore code and conversation",
        });
        treeRestoreNotifiers.set(sessionId, ctx.ui);
      }
      return;
    }

    // never — do nothing, keep mode as "Restore conversation"
    pendingTreeRestores.delete(sessionId);
    treeRestoreNotifiers.delete(sessionId);
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
    const restoreUi = ctx.hasUI
      ? ctx.ui
      : (treeRestoreNotifiers.getOrUndefined(sessionId) ??
        sessionNotifiers.getOrUndefined(sessionId));
    treeRestoreNotifiers.delete(sessionId);
    const config = getSessionConfig(sessionId);
    const treeRestoreMode = getSessionTreeRestoreMode(sessionId);
    if (restoreIntent?.mode === "Restore conversation") return;
    if (!restoreIntent && treeRestoreMode !== "always") return;

    const entries = ctx.sessionManager.getEntries();
    const treeEvent = getTreeEventRecord(event);
    const currentBranch = toTreeEntryRecords(ctx.sessionManager.getBranch());
    const oldLeafId = treeEvent?.oldLeafId;
    const oldBranch = oldLeafId ? buildBranchToEntry(entries, oldLeafId) : currentBranch;
    const targetId = restoreIntent?.targetId;
    const targetLeafId = targetId ?? treeEvent?.newLeafId;
    const targetBranch = targetLeafId ? buildBranchToEntry(entries, targetLeafId) : currentBranch;
    const targetCommit = resolveTreeTargetCommit(entries, targetBranch, targetId);
    if (!targetCommit) return;

    const cwd = sessionCwds.getOrUndefined(sessionId) ?? ctx.cwd;
    const sessionFileForRestore =
      sessionFiles.getOrUndefined(sessionId) ?? ctx.sessionManager.getSessionFile();
    clearCodeRestoreWarning(restoreUi);
    const restoreRepo = await resolveRepoForRestore(sessionId, sessionFileForRestore, cwd, config);
    if (!restoreRepo.ok) {
      if (restoreRepo.reason === "not-found") {
        showCodeRestoreWarning(restoreUi, CHECKPOINT_STORAGE_MISSING_MESSAGE);
      } else {
        notifyUnusableResumeStorage(restoreUi, restoreRepo.message);
      }
      return;
    }
    const repo = restoreRepo.repo;

    const dirtyBaseCommit =
      treeRestoreMode === "always"
        ? undefined
        : ((await findCleanCheckpointCommit(repo, getCheckpointEntries(entries))) ??
          findLatestBranchCheckpoint(entries, oldBranch)?.afterCommit);

    await safeRestoreTreeCodeState(repo, targetCommit, dirtyBaseCommit, restoreUi);
  });

  registerCheckpointStorageCommand(pi);
  registerRewind(
    pi,
    async (sessionId) => {
      const config = getSessionConfig(sessionId);
      const sessionFileForRestore = sessionFiles.getOrUndefined(sessionId);
      const cwd = sessionCwds.getOrUndefined(sessionId);
      if (!cwd) {
        return {
          ok: false,
          message: "Checkpoint extension is not ready for this session.",
          level: "warning",
        };
      }

      const restoreRepo = await resolveRepoForRestore(
        sessionId,
        sessionFileForRestore,
        cwd,
        config,
      );
      if (restoreRepo.ok) return { ok: true, repo: restoreRepo.repo };
      if (restoreRepo.reason === "not-found") {
        return {
          ok: false,
          message:
            "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
          level: "warning",
        };
      }

      return {
        ok: false,
        message: `Checkpoint storage could not be prepared for rewind: ${restoreRepo.message}`,
        level: "error",
      };
    },
    (sessionId) => {
      suppressedTreeRestores.set(sessionId, true);
    },
    (sessionId) => {
      suppressedTreeRestores.delete(sessionId);
    },
  );
}
