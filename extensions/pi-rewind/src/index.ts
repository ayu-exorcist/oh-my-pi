import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import {
  loadConfig,
  RepoManager,
  filterCheckpointEntries,
  extractCheckpointData,
  createDefaultRepoProvider,
  safeCloneSessionCheckpointStorage,
  bindSessionRepo,
  cleanupCheckpointStorage,
  cleanupLegacySessionCheckpointStorage,
  cleanupTemporaryCheckpointArtifacts,
  createCheckpointRef,
  encodeStorageComponent,
  getCheckpointRootDir,
  getLegacySessionsDir,
  getCheckpointEntries,
  resolveWorktreeCheckpointStoragePaths,
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
  sessionId: string,
  config: CheckpointConfig,
): AutoCheckpointProducer {
  return new AutoCheckpointProducer({
    repo,
    sessionId,
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

function checkpointBeforeState(checkpoint: CheckpointEntry): string | undefined {
  return checkpoint.beforeState;
}

function checkpointAfterState(checkpoint: CheckpointEntry): string | undefined {
  return checkpoint.afterState;
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
  const component = encodeStorageComponent(sessionFile ?? "ephemeral");
  return path.join(getCheckpointRootDir(), "tmp", "fork-intents", `${component}.json`);
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

async function pathSizeBytes(targetPath: string): Promise<number> {
  let total = 0;
  try {
    const info = await stat(targetPath);
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    const entries = await readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      total += await pathSizeBytes(path.join(targetPath, entry.name));
    }
  } catch {
    return total;
  }
  return total;
}

const WORKTREE_WARNING_BYTES = 2 * 1024 * 1024 * 1024;
const TOTAL_WARNING_BYTES = 10 * 1024 * 1024 * 1024;
const GLOBAL_LARGE_FILE_NOTIFICATION_STATE_KEY = "__ayulabPiRewindNotifiedLargeFiles";
const GLOBAL_TREE_RESTORE_SUPPRESSION_KEY = "__ayulabPiRewindSuppressedTreeRestores";
const GLOBAL_REGISTERED_API_STATE_KEY = "__ayulabPiRewindRegisteredApis";

type LargeFileNotificationState = Map<string, Set<string>>;
type TreeRestoreSuppressionState = Set<string>;
type RegisteredApiState = WeakSet<ExtensionAPI>;

function getRegisteredApiState(): RegisteredApiState {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_REGISTERED_API_STATE_KEY]?: RegisteredApiState;
  };
  globalState[GLOBAL_REGISTERED_API_STATE_KEY] ??= new WeakSet();
  return globalState[GLOBAL_REGISTERED_API_STATE_KEY];
}

function getLargeFileNotificationState(): LargeFileNotificationState {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_LARGE_FILE_NOTIFICATION_STATE_KEY]?: LargeFileNotificationState;
  };
  globalState[GLOBAL_LARGE_FILE_NOTIFICATION_STATE_KEY] ??= new Map();
  return globalState[GLOBAL_LARGE_FILE_NOTIFICATION_STATE_KEY];
}

function getTreeRestoreSuppressionState(): TreeRestoreSuppressionState {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_TREE_RESTORE_SUPPRESSION_KEY]?: TreeRestoreSuppressionState;
  };
  globalState[GLOBAL_TREE_RESTORE_SUPPRESSION_KEY] ??= new Set();
  return globalState[GLOBAL_TREE_RESTORE_SUPPRESSION_KEY];
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  /* c8 ignore next 4 -- GiB threshold warning paths require very large fixtures; byte formatting is exercised through cleanup messages. */
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const unit = units[unitIndex] ?? "B";
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${unit}`;
}

function summarizeRefs(refs: readonly string[], label: string): string | undefined {
  if (refs.length === 0) return undefined;
  /* c8 ignore next -- sample ref display is formatting-only; zero-ref and command message paths are covered. */
  const shown = refs.slice(0, 5).join(", ");
  /* c8 ignore next -- exercised only when cleanup reports more than five refs; summary without overflow is covered. */
  const more = refs.length > 5 ? `, … ${refs.length - 5} more` : "";
  return `${label}: ${shown}${more}`;
}

async function storageWarnings(): Promise<readonly string[]> {
  const warnings: string[] = [];
  const root = getCheckpointRootDir();
  const totalBytes = await pathSizeBytes(root);
  if (totalBytes > TOTAL_WARNING_BYTES) {
    /* c8 ignore next -- requires creating >10 GiB checkpoint fixture; threshold constant is covered by formatting tests. */
    warnings.push(`total checkpoint storage is ${formatBytes(totalBytes)}`);
  }

  const worktreesDir = path.join(root, "worktrees");
  try {
    const entries = await readdir(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bytes = await pathSizeBytes(path.join(worktreesDir, entry.name));
      if (bytes > WORKTREE_WARNING_BYTES) {
        /* c8 ignore next -- requires creating >2 GiB worktree storage fixture. */
        warnings.push(`worktree ${entry.name} checkpoint storage is ${formatBytes(bytes)}`);
      }
    }
  } catch {
    /* c8 ignore next -- defensive for checkpoint storage disappearing during warning scan. */
    return warnings;
  }
  return warnings;
}

interface LiveCheckpointRefs {
  readonly liveRefs: ReadonlySet<string>;
  readonly liveRefsByWorktree: ReadonlyMap<string, ReadonlySet<string>>;
  readonly protectedRefs: ReadonlySet<string>;
  readonly protectedWorktreeIds: ReadonlySet<string>;
}

function addCheckpointRefs(
  refs: Set<string>,
  sessionId: string,
  checkpoints: readonly CheckpointEntry[],
): void {
  for (const checkpoint of checkpoints) {
    if (checkpoint.beforeState) {
      refs.add(createCheckpointRef(sessionId, checkpoint.userEntryId, "before"));
    }
    if (checkpoint.afterState) {
      refs.add(createCheckpointRef(sessionId, checkpoint.userEntryId, "after"));
    }
  }
}

function addLiveRefsForWorktree(
  refsByWorktree: Map<string, Set<string>>,
  worktreeId: string,
  refs: ReadonlySet<string>,
): void {
  const existing = refsByWorktree.get(worktreeId) ?? new Set<string>();
  for (const ref of refs) existing.add(ref);
  refsByWorktree.set(worktreeId, existing);
}

async function collectLiveCheckpointRefs(
  currentCtx: ExtensionContext,
): Promise<LiveCheckpointRefs> {
  const liveRefs = new Set<string>();
  const liveRefsByWorktree = new Map<string, Set<string>>();
  const protectedRefs = new Set<string>();
  const protectedWorktreeIds = new Set<string>();

  addCheckpointRefs(
    protectedRefs,
    currentCtx.sessionManager.getSessionId(),
    getCheckpointEntries(currentCtx.sessionManager.getEntries()),
  );

  const currentStoragePaths = await resolveWorktreeCheckpointStoragePaths(currentCtx.cwd);
  protectedWorktreeIds.add(currentStoragePaths.worktreeId);

  const sessions = await SessionManager.listAll();
  for (const session of sessions) {
    const manager = SessionManager.open(session.path);
    const sessionRefs = new Set<string>();
    addCheckpointRefs(
      sessionRefs,
      manager.getSessionId(),
      getCheckpointEntries(manager.getEntries()),
    );
    for (const ref of sessionRefs) liveRefs.add(ref);
    const paths = await resolveWorktreeCheckpointStoragePaths(manager.getCwd());
    addLiveRefsForWorktree(liveRefsByWorktree, paths.worktreeId, sessionRefs);
  }

  for (const ref of protectedRefs) liveRefs.add(ref);
  addLiveRefsForWorktree(liveRefsByWorktree, currentStoragePaths.worktreeId, protectedRefs);
  return { liveRefs, liveRefsByWorktree, protectedRefs, protectedWorktreeIds };
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
    const checkpoint = findCheckpointForEntryId(entries, targetEntry.id);
    return checkpoint ? checkpointBeforeState(checkpoint) : undefined;
  }

  const checkpoint = findLatestBranchCheckpoint(entries, branch);
  return checkpoint ? checkpointAfterState(checkpoint) : undefined;
}

async function findCleanCheckpointCommit(
  repo: RepoManager,
  checkpoints: readonly CheckpointEntry[],
): Promise<string | undefined> {
  const commits = new Set<string>();
  for (const cp of [...checkpoints].reverse()) {
    const afterState = checkpointAfterState(cp);
    const beforeState = checkpointBeforeState(cp);
    if (afterState) commits.add(afterState);
    if (beforeState) commits.add(beforeState);
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

  const result = await repo.safeCheckout(targetCommit, dirtyBaseCommit);
  if (result.ok) return true;

  if (result.reason === "dirty") {
    ui?.notify(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before navigating the tree.",
      "warning",
    );
    return false;
  }

  if (result.reason === "dirty-check-failed") {
    ui?.notify(`Workspace cleanliness could not be verified: ${result.error}`, "error");
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
  ui: ExtensionContext["ui"] | undefined,
): Promise<void> {
  const selectedCp = selectedEntryId
    ? findCheckpointForEntryId(entries, selectedEntryId)
    : undefined;
  const latestBranchCheckpoint = findLatestBranchCheckpoint(entries, branch);
  const targetCommit =
    (selectedCp ? checkpointBeforeState(selectedCp) : undefined) ??
    (latestBranchCheckpoint ? checkpointAfterState(latestBranchCheckpoint) : undefined);
  if (!targetCommit) return;

  const dirtyBaseCommit = await findCleanCheckpointCommit(repo, getCheckpointEntries(entries));
  if (!dirtyBaseCommit) {
    ui?.notify(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before forking checkpoint state.",
      "warning",
    );
    return;
  }

  await safeRestoreTreeCodeState(repo, targetCommit, dirtyBaseCommit, ui);
}

async function restoreCloneCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  selectedEntryId: string,
  ui: ExtensionContext["ui"] | undefined,
): Promise<void> {
  const targetCp =
    findCheckpointForEntryId(entries, selectedEntryId) ?? findLatestCheckpoint(entries);
  const targetCommit = targetCp ? checkpointAfterState(targetCp) : undefined;
  if (!targetCommit) return;

  const dirtyBaseCommit = await findCleanCheckpointCommit(repo, getCheckpointEntries(entries));
  if (!dirtyBaseCommit) {
    ui?.notify(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before cloning checkpoint state.",
      "warning",
    );
    return;
  }

  await safeRestoreTreeCodeState(repo, targetCommit, dirtyBaseCommit, ui);
}

async function shouldRestoreForPolicy(
  policy: CheckpointConfig["restoreOnFork"],
  ctx: ExtensionContext,
): Promise<boolean> {
  if (policy === "always") return true;
  if (policy === "never" || !ctx.hasUI) return false;
  const choice = await ctx.ui.select("Restore files for this session branch?", ["Yes", "No"]);
  return choice === "Yes";
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
  const registeredApis = getRegisteredApiState();
  if (registeredApis.has(pi)) return;
  registeredApis.add(pi);

  const repos = provider ?? createDefaultRepoProvider();

  const producers = new SessionStateMap<AutoCheckpointProducer>();
  const sessionTasks = createSessionTaskQueue();
  const lastCheckpointTurnIds = new SessionStateMap<string>();
  const pendingTreeRestores = new SessionStateMap<TreeRestoreIntent>();
  const suppressedTreeRestores = getTreeRestoreSuppressionState();
  const sessionHasCheckpointFileChanges = new SessionStateMap<boolean>();
  const sessionNotifiedLargeFiles = getLargeFileNotificationState();
  const sessionConfigs = new SessionStateMap<CheckpointConfig>();
  let legacyCleanupScheduled = false;

  function scheduleLegacyCleanup(ctx: ExtensionContext): void {
    if (legacyCleanupScheduled) return;
    legacyCleanupScheduled = true;
    const legacyTimer = setTimeout(() => {
      Promise.all([
        cleanupLegacySessionCheckpointStorage(),
        cleanupTemporaryCheckpointArtifacts(),
      ]).catch((error: unknown) => {
        /* c8 ignore next 3 -- async startup cleanup failure path is timer-host dependent; command cleanup failure is covered. */
        if (ctx.hasUI) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Legacy checkpoint cleanup failed: ${message}`, "warning");
        }
      });
    }, 0);
    legacyTimer.unref?.();
    const retentionTimer = setTimeout(() => {
      (async () => {
        const refs = await collectLiveCheckpointRefs(ctx);
        /* c8 ignore next 7 -- delayed automatic retention uses same cleanup API covered by manual /checkpoint cleanup tests. */
        await cleanupCheckpointStorage({
          liveRefs: refs.liveRefs,
          liveRefsByWorktree: refs.liveRefsByWorktree,
          protectedRefs: refs.protectedRefs,
          protectedWorktreeIds: refs.protectedWorktreeIds,
          retention: getSessionConfig(ctx.sessionManager.getSessionId()).retention,
          apply: true,
        });
      })().catch((error: unknown) => {
        /* c8 ignore next 3 -- async retention failure path is timer-host dependent; manual cleanup failure is covered. */
        if (ctx.hasUI) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Checkpoint retention cleanup failed: ${message}`, "warning");
        }
      });
    }, 60_000);
    retentionTimer.unref?.();
  }

  function getSessionConfig(sessionId: string): CheckpointConfig {
    return sessionConfigs.getOrUndefined(sessionId) ?? loadConfig({});
  }

  function appendCheckpoint(sessionId: string, entry: CheckpointEntry): void {
    if (lastCheckpointTurnIds.getOrUndefined(sessionId) === entry.turnId) return;
    lastCheckpointTurnIds.set(sessionId, entry.turnId);
    rememberCheckpointFileChanges(sessionHasCheckpointFileChanges, sessionId, [entry]);
    pi.appendEntry("pi-checkpoint", entry);
  }

  function notifySkippedLargeFiles(
    sessionId: string,
    ctx: ExtensionContext,
    files: readonly string[],
  ): void {
    if (!ctx.hasUI || files.length === 0) return;
    const notified = sessionNotifiedLargeFiles.get(sessionId) ?? new Set<string>();
    const freshFiles = [...new Set(files)].filter((file) => !notified.has(file));
    if (freshFiles.length === 0) return;
    for (const file of freshFiles) notified.add(file);
    sessionNotifiedLargeFiles.set(sessionId, notified);
    const suffix = freshFiles.length === 1 ? freshFiles[0] : `${freshFiles.length} files`;
    ctx.ui.notify(`Checkpoint skipped large file(s): ${suffix}`, "warning");
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
    const config = loadConfig(mergeSettingsRecords(globalSettings, projectSettings));
    sessionConfigs.set(sessionId, config);

    if (event.reason === "fork") {
      if (!event.previousSessionFile) return;

      const forkIntent = await readForkIntent(sessionFile);
      scheduleLegacyCleanup(ctx);
      const storage = await safeCloneSessionCheckpointStorage({
        previousSessionFile: event.previousSessionFile,
        sessionFile,
        cwd: ctx.cwd,
        exclude: config.exclude,
        ...(config.maxFileBytes !== undefined ? { maxFileBytes: config.maxFileBytes } : {}),
      });

      if (!storage.ok) return;

      repos.setRepo(sessionId, storage.repo);
      producers.set(sessionId, createAutoCheckpointProducer(storage.repo, sessionId, config));
      sessionHasCheckpointFileChanges.set(
        sessionId,
        hasCheckpointFileChanges(ctx.sessionManager.getEntries()),
      );

      const entries = ctx.sessionManager.getEntries();
      if (forkIntent?.position === "at") {
        if (await shouldRestoreForPolicy(config.restoreOnClone, ctx)) {
          await restoreCloneCodeState(storage.repo, entries, forkIntent.entryId, ctx.ui);
        }
      } else if (await shouldRestoreForPolicy(config.restoreOnFork, ctx)) {
        await restoreForkCodeState(
          storage.repo,
          entries,
          ctx.sessionManager.getBranch(),
          forkIntent?.entryId,
          ctx.ui,
        );
      }
      return;
    }

    scheduleLegacyCleanup(ctx);
    const repo = await bindSessionRepo(sessionId, sessionFile, ctx.cwd, repos, {
      exclude: config.exclude,
      ...(config.maxFileBytes !== undefined ? { maxFileBytes: config.maxFileBytes } : {}),
    });
    const producer = createAutoCheckpointProducer(repo, sessionId, config);
    producers.set(sessionId, producer);
    sessionTasks.delete(sessionId);
    lastCheckpointTurnIds.delete(sessionId);
    sessionNotifiedLargeFiles.delete(sessionId);
    pendingTreeRestores.delete(sessionId);
    suppressedTreeRestores.delete(sessionId);
    sessionHasCheckpointFileChanges.set(
      sessionId,
      hasCheckpointFileChanges(ctx.sessionManager.getEntries()),
    );

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

  async function finalizeCheckpointForSession(
    sessionId: string,
    ctx?: ExtensionContext,
  ): Promise<void> {
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!producer) return;

      const result = await producer.finalizeRun();
      if (result.ok) {
        appendCheckpoint(sessionId, result.entry);
        if (ctx) notifySkippedLargeFiles(sessionId, ctx, result.skippedLargeFiles);
      }
    });
  }

  async function startCheckpointForLatestUser(
    sessionId: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      const config = getSessionConfig(sessionId);
      if (!config.enabled || !config.autoCheckpoint || !producer) return;

      const leaf = findLastUserEntry(ctx.sessionManager.getBranch());
      if (!leaf) return;

      const result = await producer.turnStart({
        userEntryId: leaf.id,
        prompt: extractPrompt(leaf),
      });

      if (result.ok) {
        for (const finalized of result.entries) {
          appendCheckpoint(sessionId, finalized.entry);
          notifySkippedLargeFiles(sessionId, ctx, finalized.skippedLargeFiles);
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
        prompt: extractPrompt(leaf),
      });
    });
  });

  pi.on("agent_end", async (_event, ctx) => {
    await finalizeCheckpointForSession(ctx.sessionManager.getSessionId(), ctx);
  });

  pi.on("session_before_tree", async (event, ctx) => {
    const treeEvent = getTreeEventRecord(event);
    const targetId = treeEvent?.targetId;
    if (!targetId) return;

    const sessionId = ctx.sessionManager.getSessionId();
    const config = getSessionConfig(sessionId);
    if (suppressedTreeRestores.has(sessionId)) return;

    pendingTreeRestores.set(sessionId, { targetId, mode: "Restore conversation" });

    // Summarise or Summarize with custom prompt → behave like native /tree
    // (conversation-only navigation, no file restore).
    // When userWantsSummary is undefined (e.g. legacy pi-coding-agent),
    // treat it as "not explicitly requesting summary" so that restoreOnTree
    // settings can still apply.
    if (treeEvent.userWantsSummary === true) return;

    await finalizeCheckpointForSession(sessionId, ctx);
    const hasKnownFileChanges =
      sessionHasCheckpointFileChanges.getOrUndefined(sessionId) === true ||
      hasCheckpointFileChanges(ctx.sessionManager.getEntries());
    sessionHasCheckpointFileChanges.set(sessionId, hasKnownFileChanges);

    if (config.restoreOnTree === "always") {
      pendingTreeRestores.set(sessionId, {
        targetId,
        mode: "Restore code and conversation",
      });
      return;
    }

    if (config.restoreOnTree === "ask") {
      if (!ctx.hasUI || !hasKnownFileChanges) return;

      const syncFiles = await ctx.ui.select("Sync files?", ["Yes", "No"]);
      if (syncFiles === "Yes") {
        pendingTreeRestores.set(sessionId, {
          targetId,
          mode: "Restore code and conversation",
        });
      }
      return;
    }

    // never — do nothing, keep mode as "Restore conversation"
    pendingTreeRestores.delete(sessionId);
  });

  pi.on("session_tree", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (suppressedTreeRestores.has(sessionId)) {
      suppressedTreeRestores.delete(sessionId);
      pendingTreeRestores.delete(sessionId);
      return;
    }

    const restoreIntent = pendingTreeRestores.getOrUndefined(sessionId);
    pendingTreeRestores.delete(sessionId);
    const config = getSessionConfig(sessionId);
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

    const oldBranchCheckpoint = findLatestBranchCheckpoint(entries, oldBranch);
    const dirtyBaseCommit =
      (await findCleanCheckpointCommit(repo, getCheckpointEntries(entries))) ??
      (oldBranchCheckpoint ? checkpointAfterState(oldBranchCheckpoint) : undefined);

    await safeRestoreTreeCodeState(
      repo,
      resolveTreeTargetCommit(entries, targetBranch, targetId),
      dirtyBaseCommit,
      ctx.hasUI ? ctx.ui : undefined,
    );
  });

  pi.registerCommand("checkpoint", {
    description: "Manage checkpoint storage",
    handler: async (args, ctx) => {
      const parts = args
        .trim()
        .split(/\s+/u)
        .filter((part) => part.length > 0);
      if (parts[0] !== "cleanup") {
        ctx.ui.notify("Usage: /checkpoint cleanup [--apply]", "info");
        return;
      }

      const apply = parts.includes("--apply");
      const legacyDir = getLegacySessionsDir();
      const legacyBytes = await pathSizeBytes(legacyDir);
      let refs: LiveCheckpointRefs;
      try {
        refs = await collectLiveCheckpointRefs(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Checkpoint cleanup could not verify live sessions: ${message}`, "error");
        return;
      }

      let warnings: readonly string[];
      let cleanup: Awaited<ReturnType<typeof cleanupCheckpointStorage>>;
      try {
        warnings = await storageWarnings();
        cleanup = await cleanupCheckpointStorage({
          liveRefs: refs.liveRefs,
          liveRefsByWorktree: refs.liveRefsByWorktree,
          protectedRefs: refs.protectedRefs,
          protectedWorktreeIds: refs.protectedWorktreeIds,
          retention: getSessionConfig(ctx.sessionManager.getSessionId()).retention,
          apply,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Checkpoint cleanup failed safely before deleting legacy storage: ${message}`,
          "error",
        );
        return;
      }
      const orphanRefList = cleanup.worktrees.flatMap((worktree) => worktree.orphanRefs);
      const expiredRefList = cleanup.worktrees.flatMap((worktree) => worktree.expiredRefs);
      const orphanRefs = orphanRefList.length;
      const expiredRefs = expiredRefList.length;
      const reviewDetails = [
        summarizeRefs(orphanRefList, "orphan refs"),
        summarizeRefs(expiredRefList, "retention-expired refs"),
      ]
        .filter((detail): detail is string => detail !== undefined)
        .join("; ");

      if (!apply) {
        ctx.ui.notify(
          `Checkpoint cleanup dry run: legacy session storage ${formatBytes(legacyBytes)}, ${orphanRefs} orphan refs, ${expiredRefs} retention-expired refs would be removed.${reviewDetails.length > 0 ? ` Details: ${reviewDetails}.` : ""}${warnings.length > 0 ? ` Warnings: ${warnings.join("; ")}.` : ""} Re-run /checkpoint cleanup --apply to delete them.`,
          "info",
        );
        return;
      }

      await cleanupLegacySessionCheckpointStorage();
      ctx.ui.notify(
        `Checkpoint cleanup complete: legacy session storage removed and ${cleanup.deletedRefs} refs deleted.${warnings.length > 0 ? ` Warnings: ${warnings.join("; ")}.` : ""}`,
        "info",
      );
    },
  });

  registerRewind(
    pi,
    (sessionId) => repos.getRepo(sessionId),
    /* c8 ignore next 3 -- suppression callbacks are exercised through registerRewind integration; state is closure-private. */
    (sessionId) => {
      suppressedTreeRestores.add(sessionId);
    },
    /* c8 ignore next 3 -- suppression callbacks are exercised through registerRewind integration; state is closure-private. */
    (sessionId) => {
      suppressedTreeRestores.delete(sessionId);
    },
  );
}
