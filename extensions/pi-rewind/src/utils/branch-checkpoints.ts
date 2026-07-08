import { getCheckpointEntries } from "@ayulab/pi-checkpoint";
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";
import { isUserMessageEntry } from "./tree-entry";

function getBranchUserEntryIds(branch: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of branch) {
    if (isUserMessageEntry(entry)) {
      ids.add(entry.id);
    }
  }
  return ids;
}

// Provider retries can append multiple checkpoint entries for the same visible
// user turn. Keep the earliest checkpoint for each user entry so `/rewind`
// continues to map 1:1 to the prompts shown in the conversation tree.
function dedupeCheckpointEntriesByUserEntryId(
  checkpoints: readonly CheckpointEntry[],
): readonly CheckpointEntry[] {
  const seen = new Set<string>();
  const deduped: CheckpointEntry[] = [];

  for (const checkpoint of checkpoints) {
    if (seen.has(checkpoint.userEntryId)) continue;
    seen.add(checkpoint.userEntryId);
    deduped.push(checkpoint);
  }

  return deduped;
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
  return dedupeCheckpointEntriesByUserEntryId(
    getCheckpointEntries(entries).filter((cp) => branchUserIds.has(cp.userEntryId)),
  );
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
