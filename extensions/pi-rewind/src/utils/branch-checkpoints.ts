import { getCheckpointEntries } from "@ayulab/pi-checkpoint";
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUserMessageEntry(value: unknown): value is { readonly id: string } {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (value.type !== "message" || !isRecord(value.message)) return false;
  return value.message.role === "user";
}

function getBranchUserEntryIds(branch: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of branch) {
    if (isUserMessageEntry(entry)) {
      ids.add(entry.id);
    }
  }
  return ids;
}

/**
 * Return visible Rewind checkpoints for the active conversation branch.
 *
 * Checkpoint custom entries can be appended after the decision point they
 * describe, especially when queued follow-ups are drained in the same run.
 * Therefore this reads metadata from all session entries, then filters by
 * whether the checkpoint's user decision exists on the active branch.
 */
export function getBranchCheckpointEntries(
  entries: readonly unknown[],
  branch: readonly unknown[],
): readonly CheckpointEntry[] {
  const branchUserIds = getBranchUserEntryIds(branch);
  return getCheckpointEntries(entries).filter((cp) => branchUserIds.has(cp.userEntryId));
}

export function findLatestBranchCheckpoint(
  entries: readonly unknown[],
  branch: readonly unknown[],
): CheckpointEntry | undefined {
  let latest: CheckpointEntry | undefined;
  for (const cp of getBranchCheckpointEntries(entries, branch)) {
    latest = cp;
  }
  return latest;
}
