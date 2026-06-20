# @ayulab/pi-checkpoint

## 0.6.0

### Minor Changes

- 0814aa9: Fix checkpoint storage growth and restore safety for issue #13.

  Checkpoints now use Worktree Checkpoint Storage under `~/.pi/agent/ayu/checkpoints/worktrees/<worktree-id>/`, so sessions, forks, clones, and resumes in the same resolved work tree share file-state object storage instead of creating per-session repos. Legacy per-session file storage under `~/.pi/agent/ayu/checkpoints/sessions/` and temporary checkpoint artifacts are cleaned asynchronously; old Pi conversation history remains available, but legacy file snapshots are not migrated or cloned into the new storage.

  Checkpoint entries now store `beforeState` and `afterState` file-state refs. `/rewind` keeps legacy conversation nodes visible, disables file restore when file state is legacy, expired, or cleaned, and keeps conversation-only restore available. Checkpoint commits are protected by explicit session-entry refs rather than permanent branch history, so deleting orphan or retention-expired refs allows Git GC to reclaim unreferenced file-state objects.

  Restore defaults and safety changed: `restoreOnResume` now defaults to `never`; `restoreOnFork` and `restoreOnClone` remain `always`; `restoreOnTree` remains `never`. Dirty checkpoint-managed files block restore, dirty-check failures fail closed with a distinct `dirty-check-failed` result, and cleanup fails closed if live session scanning, path validation, or ref validation cannot be verified.

  Restore commitment is limited to checkpoint-managed files under the session cwd. Built-in excludes, user `ayu.checkpoint.exclude`, project `.gitignore` rules, nested `.gitignore` rules, nested Git repo excludes, and files above an opt-in `ayu.checkpoint.maxFileBytes` cap are outside file restore. User `ayu.checkpoint.exclude` now appends to built-in safety/cost defaults instead of replacing them; defaults now include common dependencies, generated build outputs, caches, IDE folders, logs, and temp files while intentionally not excluding `vendor/` or `*.d.ts`.

  `ayu.checkpoint.maxFileBytes` is unset by default to match Gemini CLI's git-backed checkpoint behavior. If users configure a per-file cap, files above the limit are skipped with a once-per-session warning and are outside restore. File-restore retention defaults to enabled with `maxAge: "30d"`, `minRetention: "1d"`, and no default `maxCount`. `/checkpoint cleanup` dry-runs by default and `/checkpoint cleanup --apply` removes legacy storage plus orphan and retention-expired refs, then runs GC without deleting Pi conversation history or protected active worktree storage.

## 0.5.3

### Patch Changes

- 7392ebc: Refresh checkpoint exclude rules for existing and cloned storage, refresh auto-discovered embedded Git repository excludes before each staging operation, ignore nested node_modules directories by default, and remove already-indexed ignored entries from checkpoint indexes.

  This prevents broad workspace checkpoints and fork/clone restores from indexing embedded repositories or cleaning excluded work tree content.

## 0.5.2

### Patch Changes

- e374280: Updated workspace dependency versions to their latest releases.
- 62257b5: Remove retired private extension references from the published package docs and refresh the pi-checkpoint README with the current export surface and restore configuration guidance.

## 0.5.1

### Patch Changes

- 8c7fe78: Remove legacy top-level `checkpoint` settings compatibility. Checkpoint configuration must now be nested under `ayu.checkpoint`.

## 0.5.0

### Minor Changes

- c339a13: Add locked checkpoint APIs and safe session checkpoint storage helpers to reduce repo-race issues in `pi-rewind` and support safer extension/runtime checkpoint workflows.

## 0.4.1

### Patch Changes

- 97c0872: Improve pi-rewind checkpoint navigation with a tree-style `/rewind` selector, full prompt metadata preservation, and smarter `/tree` sync prompting that skips file restore prompts when checkpoints have no file changes.
- 6db8ed0: Align `ayu` settings merging with recursive project/user config handling, refresh package metadata and docs, and add git hook automation.

## 0.4.0

### Minor Changes

- 633b275: Update Rewind tree sync behavior, improve checkpoint runtime support, and migrate package releases to Changesets.

  This release simplifies Rewind restore modes, keeps native no-summary tree navigation intact, adds optional file sync during tree navigation, and updates the curated root package/release workflow for Changesets-managed publishing.
