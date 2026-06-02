import { isNumber, isRecord, isString } from "./guards";
import type { FileChange } from "./types";

/**
 * Pull `pi-checkpoint` custom entries out of a raw session entry list.
 *
 * Both `pi-rewind` and `pi-undo-redo` use this to read checkpoint metadata
 * from the session history without duplicating the extraction logic.
 */
export function extractCheckpointData(entries: readonly unknown[]): readonly unknown[] {
  return entries
    .filter(isRecord)
    .filter((e) => e.type === "custom" && e.customType === "pi-checkpoint")
    .map((e) => e.data);
}

/**
 * Checkpoint metadata stored as a Pi session custom entry.
 *
 * Introduces before/after commit pairs so that rewind can restore
 * to the state *before* a turn, while undo/redo can navigate between
 * before and after snapshots.
 */
export interface CheckpointEntry {
  /** Schema version. */
  readonly v: 2;
  /** Entry kind discriminator. */
  readonly kind: "checkpoint";
  /** Stable turn identifier. */
  readonly turnId: string;
  /** Session entry id of the user message that triggered this turn. */
  readonly userEntryId: string;
  /** Git commit hash captured at turn_start. */
  readonly beforeCommit: string;
  /** Git commit hash captured at turn_end (may equal beforeCommit). */
  readonly afterCommit: string;
  /** Truncated user prompt that created this checkpoint. */
  readonly prompt: string;
  /** Number of unique files touched in this turn. */
  readonly fileCount: number;
  /** Per-file change statistics (computed at turn_end). */
  readonly fileChanges: readonly FileChange[];
  /** ISO timestamp when the checkpoint was finalized. */
  readonly createdAt: string;
}

function isFileChange(value: unknown): value is FileChange {
  if (!isRecord(value)) return false;
  return isString(value.path) && isNumber(value.added) && isNumber(value.removed);
}

/** Type guard for {@link CheckpointEntry}. */
export function isCheckpointEntry(value: unknown): value is CheckpointEntry {
  if (!isRecord(value)) return false;
  return (
    value.v === 2 &&
    value.kind === "checkpoint" &&
    isString(value.turnId) &&
    isString(value.userEntryId) &&
    isString(value.beforeCommit) &&
    isString(value.afterCommit) &&
    isString(value.prompt) &&
    isNumber(value.fileCount) &&
    Array.isArray(value.fileChanges) &&
    value.fileChanges.every(isFileChange) &&
    isString(value.createdAt)
  );
}

/**
 * Extract checkpoint entries from a list of session entry data objects.
 *
 * @param dataList - Raw `.data` values from session custom entries.
 * @returns Only the valid {@link CheckpointEntry} objects, in order.
 */
export function filterCheckpointEntries(dataList: readonly unknown[]): readonly CheckpointEntry[] {
  return dataList.filter(isCheckpointEntry);
}

/**
 * Extract checkpoint entries from a raw session entry list.
 *
 * Convenience wrapper combining {@link extractCheckpointData} and
 * {@link filterCheckpointEntries}.
 */
export function getCheckpointEntries(entries: readonly unknown[]): readonly CheckpointEntry[] {
  return filterCheckpointEntries(extractCheckpointData(entries));
}
