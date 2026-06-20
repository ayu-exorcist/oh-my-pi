import { getCheckpointEntries } from "@ayulab/pi-checkpoint";
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";
import { isUserMessageEntry } from "./tree-entry";

function getBranchUserEntryIds(branch: readonly unknown[]): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of branch) {
    if (isUserMessageEntry(entry) && !seen.has(entry.id)) {
      ids.push(entry.id);
      seen.add(entry.id);
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
  const checkpointsByUser = new Map<string, CheckpointEntry>();
  for (const cp of getCheckpointEntries(entries)) {
    checkpointsByUser.set(cp.userEntryId, cp);
  }
  return getBranchUserEntryIds(branch).flatMap((userEntryId) => {
    const checkpoint = checkpointsByUser.get(userEntryId);
    return checkpoint ? [checkpoint] : [];
  });
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
