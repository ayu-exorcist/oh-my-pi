# ADR-0003: Before/After Commit Pairs in CheckpointEntry

## Status

Accepted

## Context

The first checkpoint design stored a single commit hash per turn. This worked for simple "restore to this point" semantics but broke down when we needed:

1. **Undo** — revert to the state _before_ a turn, then optionally redo back to the state _after_ that turn.
2. **Rewind** — jump to any historical turn and restore the workspace to its pre-turn state.
3. **Dirty guard** — compare the current working tree against a known-good snapshot to warn about unsaved changes.

A single commit hash cannot represent both "before" and "after" states.

## Decision

Store **two commit hashes** per checkpoint in the schema:

- **`beforeCommit`** — snapshot taken at `turn_start`, before the agent modifies anything.
- **`afterCommit`** — snapshot taken at `turn_end`, after the agent finishes. May equal `beforeCommit` if no files changed.

The `CheckpointEntry` schema:

```ts
interface CheckpointEntry {
  v: 2;
  kind: "checkpoint";
  turnId: string;
  userEntryId: string;
  beforeCommit: string;
  afterCommit: string;
  prompt: string;
  fileCount: number;
  fileChanges: FileChange[];
  createdAt: string;
}
```

### Command semantics

| Command                       | Target commit           | Dirty-guard base     |
| ----------------------------- | ----------------------- | -------------------- |
| `/rewind` (restore code)      | `target.beforeCommit`   | `latest.afterCommit` |
| `/undo`                       | `latest.beforeCommit`   | `latest.afterCommit` |
| `/redo`                       | `redoEntry.afterCommit` | `latest.afterCommit` |
| `/rewind` (conversation only) | — (no checkout)         | —                    |

The `redoEntry` pushed onto the redo stack during undo records `targetLeafId` and `afterCommit`, so redo knows where to navigate back to.

## Consequences

### Positive

- **Undo/redo are first-class operations**: users can step backward and forward through their session history.
- **Clean history**: when a turn makes no changes, `afterCommit === beforeCommit`, avoiding empty commits.
- **Accurate dirty guard**: compare working tree against `afterCommit` to detect unsnapshotted changes.

### Negative

- **Schema migration**: v1 entries (if any existed in earlier versions) are not backward-compatible.
- **Redo stack is in-memory only**: the redo stack lives in a `Map<string, RedoEntry[]>` inside `pi-undo-redo`. Restarting Pi loses redo history.
- **Fork semantics are subtle**: when forking a session, we clone the bare repo and optionally checkout `beforeCommit` of the latest checkpoint. The fork inherits the full commit graph.

## Related

- `sdk/pi-checkpoint/src/checkpoint-entry.ts`
- `extensions/pi-rewind/src/index.ts`
- `extensions/pi-undo-redo/src/index.ts`
