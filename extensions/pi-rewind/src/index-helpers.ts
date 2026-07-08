import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  extractCheckpointData,
  filterCheckpointEntries,
  getCheckpointEntries,
  getRepoDir,
  readCheckpointStorageManifest,
  RepoManager,
  SessionStateMap,
  writeCheckpointStorageManifest,
  type CheckpointConfig,
  type CheckpointEntry,
} from "@ayulab/pi-checkpoint";
import { isRecord } from "@ayulab/runtime-core";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AutoCheckpointProducer } from "./auto-checkpoint";
import { extractFirstUserPrompt } from "./utils/prompt";
import { findLatestBranchCheckpoint } from "./utils/branch-checkpoints";
import { isEntryWithId, isUserMessageEntry, type TreeEntryRecord } from "./utils/tree-entry";

export type TreeRestoreMode = "always" | "ask" | "never";

export interface ForkIntent {
  readonly entryId: string;
  readonly position: "before" | "at";
}

export interface TreeRestoreIntent {
  readonly targetId: string;
  readonly mode: "Restore code and conversation" | "Restore conversation";
  readonly targetCommit?: string;
}

export type RestoreRepoResult =
  | { readonly ok: true; readonly repo: RepoManager }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "unusable"; readonly message: string };

export const CODE_RESTORE_WARNING_WIDGET_ID = "pi-rewind-code-restore-warning";
export const CHECKPOINT_SESSION_STORAGE_MISSING_MESSAGE =
  "Checkpoint storage for this session is missing. File restore for existing checkpoints is unavailable.";
export const CHECKPOINT_STORAGE_MISSING_MESSAGE =
  "Files were not restored because checkpoint storage for this session is missing.";
export const CHECKPOINT_TARGET_MISSING_MESSAGE =
  "Files were not restored because the selected checkpoint is not present in checkpoint storage.";

export function mergeSettingsRecords(
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

export async function readSettingsRecord(configDir: string): Promise<Record<string, unknown>> {
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

export function resolveTreeRestoreMode(settings: Record<string, unknown>): TreeRestoreMode {
  const ayu = settings.ayu;
  if (!isRecord(ayu)) return "ask";
  const rewind = ayu.rewind;
  if (!isRecord(rewind)) return "ask";
  const restoreOnTree = rewind.restoreOnTree;
  return restoreOnTree === "always" || restoreOnTree === "ask" || restoreOnTree === "never"
    ? restoreOnTree
    : "ask";
}

export function normalizeSessionTitle(prompt: string | undefined): string {
  const collapsed = prompt?.replace(/\s+/g, " ").trim() ?? "";
  return collapsed.length > 0 ? collapsed : "Untitled session";
}

export function toMaxFileBytes(config: CheckpointConfig): number | undefined {
  return typeof config.maxFileMB === "number"
    ? Math.max(1, Math.floor(config.maxFileMB * 1024 * 1024))
    : undefined;
}

export function configureRepo(repo: RepoManager, config: CheckpointConfig): void {
  repo.setMaxFileBytes(toMaxFileBytes(config));
}

export function createAutoCheckpointProducer(
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

export async function syncCheckpointStorageManifest(
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

export function notifySafeCheckoutFailure(
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

export function findCheckpointForEntryId(
  entries: readonly unknown[],
  entryId: string,
): CheckpointEntry | undefined {
  const dataList = extractCheckpointData(entries);
  return filterCheckpointEntries(dataList).find((checkpoint) => checkpoint.userEntryId === entryId);
}

export function showCodeRestoreWarning(
  ui: ExtensionContext["ui"] | undefined,
  message: string,
): void {
  ui?.setWidget(CODE_RESTORE_WARNING_WIDGET_ID, (_tui, theme) => {
    return new Text(theme.fg("warning", `Warning: ${message}`), 0, 0);
  });
}

export function clearCodeRestoreWarning(ui: ExtensionContext["ui"] | undefined): void {
  ui?.setWidget(CODE_RESTORE_WARNING_WIDGET_ID, undefined);
}

export function notifyUnusableResumeStorage(
  ui: ExtensionContext["ui"] | undefined,
  message: string,
): void {
  ui?.notify(`Checkpoint storage could not be prepared for resume restore: ${message}`, "error");
}

export function checkpointHasFileChanges(checkpoint: CheckpointEntry): boolean {
  return checkpoint.fileCount > 0 || checkpoint.fileChanges.length > 0;
}

export function hasCheckpointFileChanges(entries: readonly unknown[]): boolean {
  return getCheckpointEntries(entries).some(checkpointHasFileChanges);
}

export function mergeCheckpointEntries(
  entries: readonly unknown[],
  runtimeCheckpoints: readonly CheckpointEntry[] | undefined,
): readonly CheckpointEntry[] {
  const merged = new Map<string, CheckpointEntry>();
  for (const checkpoint of runtimeCheckpoints ?? []) {
    merged.set(`${checkpoint.turnId}:${checkpoint.userEntryId}`, checkpoint);
  }
  for (const checkpoint of getCheckpointEntries(entries)) {
    merged.set(`${checkpoint.turnId}:${checkpoint.userEntryId}`, checkpoint);
  }
  return [...merged.values()];
}

export function findLatestBranchCheckpointFromList(
  checkpoints: readonly CheckpointEntry[],
  branch: readonly TreeEntryRecord[],
): CheckpointEntry | undefined {
  const branchUserIds = new Set(branch.filter(isUserMessageEntry).map((entry) => entry.id));
  let latest: CheckpointEntry | undefined;
  for (const checkpoint of checkpoints) {
    if (branchUserIds.has(checkpoint.userEntryId)) latest = checkpoint;
  }
  return latest;
}

export function resolveBranchCodeCommit(
  entries: readonly unknown[],
  branch: readonly TreeEntryRecord[],
): string | undefined {
  return findLatestBranchCheckpoint(entries, branch)?.afterCommit;
}

export function needsCodeSync(
  currentCommit: string | undefined,
  targetCommit: string | undefined,
): boolean {
  return !!targetCommit && currentCommit !== targetCommit;
}

export function rememberCheckpointFileChanges(
  state: SessionStateMap<boolean>,
  sessionId: string,
  entries: readonly unknown[],
): void {
  const checkpoints = filterCheckpointEntries(entries);
  const hasFileChanges = checkpoints.some(checkpointHasFileChanges);
  state.set(sessionId, state.getOrUndefined(sessionId) === true || hasFileChanges);
}

export function createSessionTaskQueue() {
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

export function findLatestCheckpoint(entries: readonly unknown[]): CheckpointEntry | undefined {
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

export function buildBranchToEntry(
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

export function resolveTreeTargetCommit(
  entries: readonly unknown[],
  branch: readonly TreeEntryRecord[],
  targetId: string | undefined,
  checkpoints: readonly CheckpointEntry[] = getCheckpointEntries(entries),
): string | undefined {
  const targetEntry = targetId ? findEntryById(entries, targetId) : undefined;
  if (isUserMessageEntry(targetEntry)) {
    return checkpoints.find((checkpoint) => checkpoint.userEntryId === targetEntry.id)
      ?.beforeCommit;
  }

  return findLatestBranchCheckpointFromList(checkpoints, branch)?.afterCommit;
}

export async function findCleanCheckpointCommit(
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

export async function safeRestoreTreeCodeState(
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
  /* v8 ignore next */
  if (result.ok) {
    return true;
  }

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

export async function restoreForkCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  branch: readonly TreeEntryRecord[],
  selectedEntryId: string | undefined,
  ui: ExtensionContext["ui"] | undefined,
): Promise<string | undefined> {
  const selectedCp = selectedEntryId
    ? findCheckpointForEntryId(entries, selectedEntryId)
    : undefined;
  const targetCommit =
    selectedCp?.beforeCommit ?? findLatestBranchCheckpoint(entries, branch)?.afterCommit;
  if (!targetCommit) return undefined;

  const result = await repo.safeCheckout(targetCommit);
  if (result.ok) return targetCommit;

  notifySafeCheckoutFailure(
    ui,
    result,
    "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before restoring fork files.",
    "Could not verify the workspace is clean. Clean up workspace changes before restoring fork files.",
    "Fork file restore failed",
    "Fork file restore failed and rollback also failed",
  );
  return undefined;
}

export async function restoreCloneCodeState(
  repo: RepoManager,
  entries: readonly unknown[],
  selectedEntryId: string,
  ui: ExtensionContext["ui"] | undefined,
): Promise<string | undefined> {
  const targetCp =
    findCheckpointForEntryId(entries, selectedEntryId) ?? findLatestCheckpoint(entries);
  if (!targetCp) return undefined;

  const result = await repo.safeCheckout(targetCp.afterCommit);
  if (result.ok) return targetCp.afterCommit;

  notifySafeCheckoutFailure(
    ui,
    result,
    "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before restoring cloned files.",
    "Could not verify the workspace is clean. Clean up workspace changes before restoring cloned files.",
    "Clone file restore failed",
    "Clone file restore failed and rollback also failed",
  );
  return undefined;
}
