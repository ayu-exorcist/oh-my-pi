# Checkpoint Engine

A file-level snapshot engine for Pi sessions. Uses git bare repositories to capture workspace state at turn boundaries, enabling restore and rewind operations across the conversation tree.

## Language

**Checkpoint**:
A snapshot of the workspace captured around a single Turn. Represented in the session as a `CheckpointEntry` containing the commit hashes taken before and after the agent's work.
_Avoid_: snapshot, savepoint, revision

**Turn**:
A complete user request-response cycle in a Pi session, bounded by `turn_start` and `turn_end` events. Each Turn may produce one Checkpoint if checkpointing is enabled.
_Avoid_: step, round, iteration

**beforeCommit**:
The git commit hash captured at `turn_start`, reflecting the workspace state before the agent begins modifying files.
_Avoid_: start commit, pre-turn commit, initial commit

**afterCommit**:
The git commit hash captured at `turn_end`, reflecting the workspace state after the agent finishes all modifications. When no files changed during the Turn, `afterCommit` is the same as `beforeCommit` — no empty commit is created.
_Avoid_: end commit, post-turn commit, final commit

**Checkpoint Lock**:
An exclusive filesystem lock acquired before any destructive repo operation (checkpoint, checkout, reset). Uses atomic `mkdir` with 30-second stale-detection to serialize access across processes. Held for the duration of `safeCheckout` and other critical sections.
_Avoid_: repo lock, mutex, file lock

**Checkpoint Storage**:
The on-disk git bare repository and index file that hold the file snapshots referenced by `CheckpointEntry` metadata. Checkpoint Storage is addressed through the session file path and work tree, not through shared in-memory state, so independently installed Pi Packages can interoperate through the same protocol seam.
_Avoid_: repo storage, snapshot store, shared provider

**Dirty Workspace**:
A working tree that contains unsnapshotted changes — modifications made after the latest `afterCommit` that have not been committed. Commands like `/rewind` refuse to proceed against a dirty workspace to prevent data loss.
_Avoid_: modified, uncommitted, out of sync

**Safety Commit**:
A temporary commit created immediately before a destructive checkout. If the checkout fails, the engine rolls back to the safety commit. If safety commit creation also fails, checkout proceeds without rollback protection.
_Avoid_: backup commit, guard commit, temp commit

**RepoProvider**:
The storage seam that binds `RepoManager` instances to session IDs. Production uses an in-memory Map; tests inject mock adapters to avoid filesystem I/O.
_Avoid_: repo factory, repo registry, repo store

## Flagged ambiguities

- **"Checkpoint" vs "CheckpointEntry"**: `Checkpoint` is the domain concept (a snapshot of a Turn). `CheckpointEntry` is the concrete schema object stored in the Pi session. In casual discussion they are used interchangeably; in precise discussion, `CheckpointEntry` refers to the data structure.
- **User-facing restore actions are not engine concepts**: The engine only knows `safeCheckout`. Whether a checkout represents rewinding, restoring, or another product action is decided by the caller.
- **Checkpoint Storage is the cross-package seam**: Pi Packages may load separate copies of `@ayulab/pi-checkpoint`, so cross-package coordination must use `CheckpointEntry` metadata plus Checkpoint Storage on disk, not a shared `RepoProvider` instance.

## Example dialogue

> **Dev**: I'm adding `/branch` support and need to fork a session's checkpoint history. What's the right entry point?
>
> **Domain expert**: Use `safeCloneSessionCheckpointStorage` to copy the bare repo under the session storage seam, then restore the fork target if needed. If you need to compose several raw repo steps yourself, use `RepoManager.withLock` and the low-level primitives.
>
> **Dev**: What if the user wants a single checkpoint write with built-in serialization?
>
> **Domain expert**: Use `lockedCheckpoint`. It's a convenience wrapper around the raw `checkpoint` primitive, so the caller does not need to manage locking manually.
>
> **Dev**: What if the user has unsaved changes when they run `/branch`?
>
> **Domain expert**: That's a Dirty Workspace. You should run `safeCheckout` with a `dirtyBaseCommit` — pass the latest `afterCommit`. If the workspace is dirty, `safeCheckout` returns `{ ok: false, reason: "dirty" }` and you warn the user before proceeding.
>
> **Dev**: And if the checkout to an old `beforeCommit` fails?
>
> **Domain expert**: `safeCheckout` creates a Safety Commit first. If the checkout fails, it automatically rolls back to that safety commit. The caller just needs to handle the `SafeCheckoutResult` — either success with optional `safetyHash`, or failure with error details.
