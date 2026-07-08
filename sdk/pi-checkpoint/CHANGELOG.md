# @ayulab/pi-checkpoint

## 0.6.4

### Patch Changes

- 80d85d0: Guard checkpoint storage deletion with the checkpoint repo lock and report busy storage when another checkpoint operation is active.
- 478487a: Remove empty skills and prompt-template resource declarations from the root package, split test-targeted rewind helpers into regular helper modules, and deduplicate checkpoint runtime helpers.

## 0.6.3

### Patch Changes

- 9c7bd2f: Fix checkpoint lock recovery so malformed stale lock paths do not busy-loop during automatic checkpoints, and add clear timeout warnings for lock waits and Git subprocesses.

## 0.6.2

### Patch Changes

- 222ea66: Return structured checkpoint-storage delete failures instead of throwing raw filesystem errors, retry Windows removals more defensively, and keep `/checkpoint` delete failures inside the selector UI instead of crashing Pi.

## 0.6.1

### Patch Changes

- d20e1b0: Bump package versions past npm versions that were previously published and unpublished, so the next release can publish fresh package versions.

## 0.6.0

### Minor Changes

- a9a2e1f: Update `pi-rewind` restore behavior so `/tree` defaults to `ayu.rewind.restoreOnTree: "ask"`, while `restoreOnTree: "always"`, `restoreOnResume: true`, `restoreOnFork: true`, and `restoreOnClone: true` force restore checkpoint-managed files without a dirty-workspace prompt. `restoreOnResume` now also applies when opening an existing session from startup selection such as `pi -r`.

  Restore feedback is now tied to the actual restore target: existing-session and `/tree` storage failures show warning-themed messages above the editor input, distinguish whole-session storage loss from a selected checkpoint commit missing in storage, and clear on the next user input. `/rewind` continues to report missing code-restore storage through its command UI while keeping conversation restore available.

  For `@ayulab/pi-checkpoint`, checkpoint storage deletion now treats an already-removed storage directory as a successful delete after path, manifest, and active-session safety checks have passed, avoiding stale-selector `ENOENT` failures.

## 0.5.4

### Patch Changes

- e8c2a98: Finish phase 1 of the checkpoint storage fix:

  - harden checkpoint restore preflight with fail-closed checkout behavior and clearer restore failure handling
  - expand built-in checkpoint excludes, add `ayu.checkpoint.include`, and add opt-in `ayu.checkpoint.maxFileMB`
  - make resume conversation-only by default with `restoreOnResume: "never"`, while keeping `/tree` conversation-first and preserving fork and clone restore defaults
  - add `/checkpoint` storage management with per-storage manifests, orphan detection, and explicit delete
  - document the phase 1 nested Git repository boundary and storage-management behavior
  - refresh workspace development typing to `@types/node@26`

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
