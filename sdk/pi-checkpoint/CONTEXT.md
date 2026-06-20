# Checkpoint Engine

A file-level snapshot engine for Pi sessions. Uses git bare repositories to capture workspace state at turn boundaries, enabling restore and rewind operations across the conversation tree.

## Language

**Checkpoint**:
A snapshot of the workspace captured around a single Turn. Represented in the session as a `CheckpointEntry` containing the commit hashes taken before and after the agent's work.
_Avoid_: snapshot, savepoint, revision

**Turn**:
A complete user request-response cycle in a Pi session. In `pi-rewind`, capture starts when the assistant message begins for the latest user entry, records turn-end prompt metadata at `turn_end`, and finalizes after `agent_end`. Each Turn may produce one Checkpoint if checkpointing is enabled.
_Avoid_: step, round, iteration

**beforeCommit**:
The git commit hash captured when a Turn starts, reflecting the workspace state before the agent begins modifying files.
_Avoid_: start commit, pre-turn commit, initial commit

**afterCommit**:
The git commit hash captured when the Turn is finalized, reflecting the workspace state after the agent finishes all modifications. When no files changed during the Turn, `afterCommit` is the same as `beforeCommit` — no empty commit is created.
_Avoid_: end commit, post-turn commit, final commit

**Checkpoint Lock**:
An exclusive filesystem lock acquired before any destructive repo operation (checkpoint, checkout, reset). Uses atomic `mkdir` with 30-second stale-detection to serialize access across processes. Held for the duration of `safeCheckout` and other critical sections.
_Avoid_: repo lock, mutex, file lock

**Checkpoint Storage**:
The on-disk git bare repository and index file that hold the file snapshots referenced by `CheckpointEntry` metadata. Checkpoint Storage is addressed through the session file path and work tree, not through shared in-memory state, so independently installed Pi Packages can interoperate through the same protocol seam.
_Avoid_: repo storage, snapshot store, shared provider

**Worktree Checkpoint Storage**:
A shared Checkpoint Storage for one resolved work tree. It stores Checkpoint States for all sessions opened in that work tree under `~/.pi/agent/ayu/checkpoints/worktrees/<worktree-id>/`, so sessions, forks, and clones reference shared file-state objects instead of copying a per-session repository.
_Avoid_: session repo, per-session storage

**Worktree ID**:
A stable identifier for Worktree Checkpoint Storage derived from a project registry keyed by normalized real paths. The ID selects the storage directory for all sessions opened in the same resolved work tree.
_Avoid_: session id, path slug, repo id

**Checkpoint State**:
A commit in Worktree Checkpoint Storage that represents the restorable file state for checkpoint-managed files under the session cwd, excluding configured and internal excludes. CheckpointEntry metadata records explicit `beforeState` and `afterState` Checkpoint States for each user Turn; equal states may reference the same commit.
_Avoid_: tree node state, workspace snapshot, state version

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
- **Nested Git repository excludes are scoped behavior, not global failure**: When a session starts in a broad workspace such as `Desktop`, nested Git repository roots are excluded from the outer Checkpoint to avoid gitlink indexing and ambiguous restore behavior. Checkpoint and Rewind still cover non-excluded files in the outer work tree. Refresh internal excludes before staging, and write them to cloned Checkpoint Storage before checkout/restore, so newly-created nested repositories and excluded work tree content stay protected. To protect a nested repository, start the session at that repository root.
- **Changed-path capture is a possible future architecture**: A Turn-level changed-path log with before/after content capture can optimize changed-path hints, file-change display, no-op detection, and safety backups, but it must not replace full-worktree Checkpoint State as the restore source of truth. Full file restore must cover checkpoint-managed files changed by shell commands as well as Pi file tools.
- **Checkpoint State uses commits, not bare tree objects**: Tree objects are lighter, but commit hashes are easier to diff, restore, protect with refs, inspect with standard git tooling, and garbage-collect safely. Equal states should reuse the same commit rather than creating empty commits.
- **Worktree storage replaces per-session storage**: Checkpoint Storage should be shared by Worktree ID, not copied per session. New `CheckpointEntry` metadata should keep explicit `beforeState` and `afterState` fields so `/rewind` can keep its user-node interaction while storage deduplicates identical states.
- **Garbage collection deletes only proven-orphan live data by default**: Default GC may automatically remove orphan refs and orphan storage, but checkpoints still referenced by Pi session history should only produce warnings unless the user explicitly requests cleanup.
- **Legacy and temporary checkpoint storage is removed asynchronously**: The legacy `~/.pi/agent/ayu/checkpoints/sessions/` directory is deleted automatically by a non-blocking package activation or startup cleanup path, without a marker file and without migration. Temporary session checkpoint artifacts may also be deleted asynchronously on startup, similar to Gemini CLI's project temp `checkpoints/` cleanup. Durable Worktree Checkpoint Storage under `~/.pi/agent/ayu/checkpoints/worktrees/<worktree-id>/` must never be removed by startup temp cleanup; it is cleaned only through refs, retention, and git GC. Do not use npm `postinstall` to touch the user's home directory, and do not synchronously block the main session-start path on large deletion. Cleanup failures should notify or log and can be retried later because the delete operation is idempotent. The CHANGELOG for the release must clearly state that old Pi sessions may keep conversation history but cannot restore files through the new storage path, and that legacy checkpoint file storage and temporary checkpoint artifacts are deleted during upgrade or startup cleanup.
- **Default excludes are conservative generated-content guards**: Default excludes cover high-confidence generated, dependency, cache, temporary, IDE, and build-output paths across common ecosystems, in addition to project `.gitignore` rules. The first default list is `.git/`, `.pi/`, `node_modules/`, `**/node_modules/`, `.gradle/`, `**/.gradle/`, `.ark/`, `**/.ark/`, `.next/`, `**/.next/`, `.nuxt/`, `**/.nuxt/`, `.svelte-kit/`, `**/.svelte-kit/`, `.angular/`, `**/.angular/`, `.vite/`, `**/.vite/`, `.parcel-cache/`, `**/.parcel-cache/`, `.turbo/`, `**/.turbo/`, `dist/`, `**/dist/`, `build/`, `**/build/`, `target/`, `**/target/`, `coverage/`, `**/coverage/`, `.cache/`, `**/.cache/`, `.venv/`, `**/.venv/`, `venv/`, `**/venv/`, `.tox/`, `**/.tox/`, `__pycache__/`, `**/__pycache__/`, `.pytest_cache/`, `**/.pytest_cache/`, `.mypy_cache/`, `**/.mypy_cache/`, `.ruff_cache/`, `**/.ruff_cache/`, `htmlcov/`, `**/htmlcov/`, `*.pyc`, `Pods/`, `**/Pods/`, `.expo/`, `**/.expo/`, `.cxx/`, `**/.cxx/`, `.externalNativeBuild/`, `**/.externalNativeBuild/`, `.build/`, `**/.build/`, `DerivedData/`, `**/DerivedData/`, `.terraform/`, `**/.terraform/`, `.serverless/`, `**/.serverless/`, `.aws-sam/`, `**/.aws-sam/`, `.idea/`, `**/.idea/`, `.vscode/`, `**/.vscode/`, `*.log`, `*.tmp`, `*.temp`, `.DS_Store`, and `Thumbs.db`. Do not default-exclude or document `vendor/`, `**/vendor/`, or `*.d.ts` as recommended excludes because they may contain source files that users expect Checkpoint to protect.
- **Restore commitment is scoped to checkpoint-managed files**: Checkpoint and Rewind restore files under the session cwd only when they are not excluded by internal defaults, user `ayu.checkpoint.exclude`, project `.gitignore`, or nested `.gitignore` rules. Ignored and excluded files are outside the file-restore commitment even when they exist under cwd. User-facing docs must state this commitment clearly.
- **User excludes append to default excludes**: `ayu.checkpoint.exclude` adds project- or user-specific excludes on top of the built-in default excludes; it does not replace the defaults. The built-in defaults protect safety and cost boundaries such as `.git`, `.pi`, dependency folders, caches, and build outputs. A future advanced override would need an explicit separate setting.
- **No include or unignore in the first Worktree Checkpoint Storage design**: Files ignored by built-in defaults, user excludes, or `.gitignore` rules stay outside Checkpoint. Do not add include/negative patterns until there is a concrete use case and a tested precedence model.
- **Restore fails closed on dirty checkpoint-managed files**: Before destructive restore, dirty guard checks checkpoint-managed files. If any checkpoint-managed file has uncheckpointed changes, restore is refused and the caller should tell the user to save, commit, or create a new checkpoint before retrying. Ignored and excluded dirty files are outside the restore commitment, do not block restore, and should stay quiet by default; expose them only through debug, verbose, explain, or diagnostics paths. Future UX may add an explicit force/override or a confirm-and-create-safety-checkpoint flow, but the first Worktree Checkpoint Storage implementation should not provide those bypasses.
- **Dirty-check failures are distinct from dirty workspaces**: If dirty guard cannot verify checkpoint-managed cleanliness because the underlying diff, status, index, or ignore evaluation fails, restore must still fail closed with a distinct `dirty-check-failed` reason. A `dirty` result means checkpoint-managed uncheckpointed changes were confirmed; `dirty-check-failed` means safety could not be proven. Callers should present different user messages for these cases.
- **File deletion is part of Checkpoint State**: Deleting a checkpoint-managed file is a first-class state transition. Checkpoint State must capture deletions, and `fileChanges` must represent deleted paths. Restoring an older state recreates checkpoint-managed files that existed in that state; restoring a newer state removes checkpoint-managed files absent from that state. This is required for exact restore within checkpoint-managed scope.
- **Large-file limit is opt-in**: Gemini CLI's checkpointing path does not define a hard-coded file-size cap; it snapshots through git and relies on ignore rules. Match that behavior by leaving `ayu.checkpoint.maxFileBytes` unset by default. When users configure a limit, files above that limit are skipped, warned once per session/file by Rewind, and outside Checkpoint State and restore commitment. User-facing docs must explain this boundary.
- **File-restore retention is automatic but conversation-safe**: Default cleanup automatically removes proven orphan refs and orphan storage, and it may remove retention-expired file-restore refs and objects. Retention applies to file-restore state, not Pi conversation history. The first defaults should mirror Gemini-style retention: enabled, `maxAge` of `"30d"`, `minRetention` of `"1d"`, and configurable `maxCount` left unset by default. Current active session refs, locked worktree storage, and refs currently being written are always protected. If live-session enumeration, ref validation, or path safety checks fail, cleanup must fail closed and delete nothing for that pass. Warning thresholds should remain broad, such as 2 GiB per Worktree Checkpoint Storage and 10 GiB total checkpoint storage. Provide `/checkpoint cleanup` for user-initiated review and cleanup, backed by an SDK cleanup API. Dry-run is the default; apply mode may delete proven-orphan and retention-expired file-restore state. When retention removes a state still mentioned by conversation history, Rewind should keep the user node visible but disable file restore with an expired-or-cleaned-up message.
- **Worktree storage starts with JSON metadata**: The first Worktree Checkpoint Storage layout is `~/.pi/agent/ayu/checkpoints/worktrees.json` plus `worktrees/<worktree-id>/repo.git`, `index`, `metadata.json`, and `lock/`. `metadata.json` stores lightweight per-worktree metadata such as IDs, real path, timestamps, and last GC time. Do not introduce SQLite in the first implementation; evolve to SQLite or a richer metadata store later only when size accounting, richer GC, indexing, or complex queries require it.
- **Checkpoint refs are session-entry refs**: Worktree Checkpoint Storage protects live states with refs shaped like `refs/ayu/checkpoints/sessions/<session-id>/<user-entry-id>/before` and `refs/ayu/checkpoints/sessions/<session-id>/<user-entry-id>/after`. The `before` ref protects `CheckpointEntry.beforeState`; the `after` ref protects `CheckpointEntry.afterState`. Git object identity provides deduplication, so multiple refs may point at the same commit. GC determines orphan refs by comparing these refs with live Pi session history, then lets git GC reclaim objects after orphan refs are removed.
- **Path and ref components are sanitized, never interpolated raw**: Session IDs, user entry IDs, worktree IDs, and any identifier used in filesystem paths or git refs must be encoded or sanitized before use. Reject empty values, traversal segments, path separators, invalid git-ref segments, control characters, and reserved storage names such as `worktrees`, `repo.git`, `index`, `metadata.json`, `lock`, `sessions`, and `checkpoints`. Use git ref validation or an equivalent strict encoder for ref components. Cleanup must fail closed when a path or ref component cannot be proven safe.
- **Legacy CheckpointEntries keep conversation rewind only**: Old sessions may still contain conversation history and legacy checkpoint metadata after the storage redesign. Rewind should keep showing legacy user nodes when conversation history exists, but file-restore actions for those nodes should be disabled with a clear incompatibility or cleanup message. Conversation-only restore remains available; do not hide legacy nodes or defer the incompatibility error until after the user selects file restore.
- **Resume is conversation-first, fork and clone are branch-entry actions**: `restoreOnResume` defaults to `"never"` so resuming a conversation does not unexpectedly modify the workspace. Users who want resume-time file synchronization must opt in explicitly. `restoreOnFork` and `restoreOnClone` remain `"always"` by default because fork and clone are explicit branch-entry actions with stronger file-restore expectations. User-facing docs and the CHANGELOG must explain this difference.
- **Tree navigation does not restore files by default**: `restoreOnTree` remains `"never"` by default. The `/tree` command is conversation navigation; `/rewind` is the explicit restore entry point. If users opt into tree-time file restore, it must still obey checkpoint-managed dirty guard, restore commitment, and excluded-file boundaries.
- **Storage redesign requires release documentation**: Implementing Worktree Checkpoint Storage is a package behavior change and must include changesets plus user-facing README, CHANGELOG, or migration-note updates. The release notes must cover the storage path change, legacy file-restore incompatibility, legacy and temporary storage cleanup, restore default changes, restore commitment boundaries, large-file limit, exclude semantics changing from replace to append, default exclude list changes, file-restore retention defaults, and the `/checkpoint cleanup` command. Determine affected packages from the implementation; changes touching both Checkpoint Engine and Rewind behavior should include release notes for both packages.

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
