import { getNumberField, getStringField, isRecord } from "@ayulab/runtime-core";
import type { FileChange } from "./types";

/**
 * Pull `pi-checkpoint` custom entries out of a raw session entry list.
 *
 * Checkpoint-aware extensions use this to read checkpoint metadata from the
 * session history without duplicating the extraction logic.
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
 * Introduces before/after commit pairs so that rewind can restore to the state
 * *before* a turn, while other restore flows can navigate between before and
 * after snapshots.
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
  /** Checkpoint State commit captured at turn_start. */
  readonly beforeState: string;
  /** Checkpoint State commit captured at turn_end (may equal beforeState). */
  readonly afterState: string;
  /** Truncated user prompt that created this checkpoint. */
  readonly prompt: string;
  /** Number of unique files touched in this turn. */
  readonly fileCount: number;
  /** Per-file change statistics (computed at turn_end). */
  readonly fileChanges: readonly FileChange[];
  /** ISO timestamp when the checkpoint was finalized. */
  readonly createdAt: string;
}

interface LegacyCheckpointEntry extends CheckpointEntry {
  readonly legacyFileState: true;
}

function markLegacyFileState(entry: CheckpointEntry): LegacyCheckpointEntry {
  return { ...entry, legacyFileState: true };
}

/** Return whether this entry refers to incompatible legacy file storage. */
export function hasLegacyFileState(entry: CheckpointEntry): boolean {
  return isRecord(entry) && entry.legacyFileState === true;
}

function normalizeAliasCheckpointEntry(value: unknown): CheckpointEntry | undefined {
  if (!isRecord(value) || value.v !== 2 || value.kind !== "checkpoint") return undefined;
  const beforeCommit = getStringField(value, "beforeCommit");
  const afterCommit = getStringField(value, "afterCommit");
  const turnId = getStringField(value, "turnId");
  const userEntryId = getStringField(value, "userEntryId");
  const prompt = getStringField(value, "prompt");
  const fileCount = getNumberField(value, "fileCount");
  const createdAt = getStringField(value, "createdAt");
  const fileChanges = Array.isArray(value.fileChanges)
    ? value.fileChanges.filter(isFileChange)
    : undefined;
  if (
    !beforeCommit ||
    !afterCommit ||
    !turnId ||
    !userEntryId ||
    !prompt ||
    fileCount === undefined ||
    !fileChanges ||
    !createdAt
  ) {
    return undefined;
  }
  return markLegacyFileState({
    v: 2,
    kind: "checkpoint",
    turnId,
    userEntryId,
    beforeState: beforeCommit,
    afterState: afterCommit,
    prompt,
    fileCount,
    fileChanges,
    createdAt,
  });
}

function normalizeLegacyCheckpointEntry(value: unknown): CheckpointEntry | undefined {
  if (!isRecord(value)) return undefined;
  const entryId = getStringField(value, "entryId");
  const commitHash = getStringField(value, "commitHash");
  const prompt = getStringField(value, "prompt") ?? "(legacy checkpoint)";
  const fileCount = getNumberField(value, "fileCount") ?? 0;
  const timestamp = getNumberField(value, "timestamp");
  const fileChanges = Array.isArray(value.fileChanges)
    ? value.fileChanges.filter(isFileChange)
    : [];
  if (!entryId || !commitHash) return undefined;
  return markLegacyFileState({
    v: 2,
    kind: "checkpoint",
    turnId: `legacy:${entryId}`,
    userEntryId: entryId,
    beforeState: commitHash,
    afterState: commitHash,
    prompt,
    fileCount,
    fileChanges,
    createdAt: timestamp ? new Date(timestamp).toISOString() : new Date(0).toISOString(),
  });
}

function isFileChange(value: unknown): value is FileChange {
  return (
    isRecord(value) &&
    getStringField(value, "path") !== undefined &&
    getNumberField(value, "added") !== undefined &&
    getNumberField(value, "removed") !== undefined
  );
}

/** Type guard for {@link CheckpointEntry}. */
export function isCheckpointEntry(value: unknown): value is CheckpointEntry {
  if (!isRecord(value)) return false;
  return (
    value.v === 2 &&
    value.kind === "checkpoint" &&
    getStringField(value, "turnId") !== undefined &&
    getStringField(value, "userEntryId") !== undefined &&
    getStringField(value, "beforeState") !== undefined &&
    getStringField(value, "afterState") !== undefined &&
    getStringField(value, "prompt") !== undefined &&
    getNumberField(value, "fileCount") !== undefined &&
    Array.isArray(value.fileChanges) &&
    value.fileChanges.every(isFileChange) &&
    getStringField(value, "createdAt") !== undefined
  );
}

/**
 * Extract checkpoint entries from a list of session entry data objects.
 *
 * @param dataList - Raw `.data` values from session custom entries.
 * @returns Only the valid {@link CheckpointEntry} objects, in order.
 */
export function filterCheckpointEntries(dataList: readonly unknown[]): readonly CheckpointEntry[] {
  return dataList.flatMap((entry) => {
    if (isCheckpointEntry(entry)) return [entry];
    const alias = normalizeAliasCheckpointEntry(entry);
    if (alias) return [alias];
    const legacy = normalizeLegacyCheckpointEntry(entry);
    return legacy ? [legacy] : [];
  });
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
