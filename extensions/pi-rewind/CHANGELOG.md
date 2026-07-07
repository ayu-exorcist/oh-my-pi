# @ayulab/pi-rewind

## 0.4.3

### Patch Changes

- 9c7bd2f: Fix checkpoint lock recovery so malformed stale lock paths do not busy-loop during automatic checkpoints, and add clear timeout warnings for lock waits and Git subprocesses.
- e14a93d: Skip Rewind and tree file-sync prompts when the target conversation point already matches the currently synced code checkpoint, while prompting again after code has been restored to an older checkpoint.
- Updated dependencies [9c7bd2f]
  - @ayulab/pi-checkpoint@0.6.3

## 0.4.2

### Patch Changes

- 222ea66: Return structured checkpoint-storage delete failures instead of throwing raw filesystem errors, retry Windows removals more defensively, and keep `/checkpoint` delete failures inside the selector UI instead of crashing Pi.
- Updated dependencies [222ea66]
  - @ayulab/pi-checkpoint@0.6.2

## 0.4.1

### Patch Changes

- d20e1b0: Bump package versions past npm versions that were previously published and unpublished, so the next release can publish fresh package versions.
- Updated dependencies [d20e1b0]
  - @ayulab/pi-checkpoint@0.6.1

## 0.4.0

### Minor Changes

- a9a2e1f: Update `pi-rewind` restore behavior so `/tree` defaults to `ayu.rewind.restoreOnTree: "ask"`, while `restoreOnTree: "always"`, `restoreOnResume: true`, `restoreOnFork: true`, and `restoreOnClone: true` force restore checkpoint-managed files without a dirty-workspace prompt. `restoreOnResume` now also applies when opening an existing session from startup selection such as `pi -r`.

  Restore feedback is now tied to the actual restore target: existing-session and `/tree` storage failures show warning-themed messages above the editor input, distinguish whole-session storage loss from a selected checkpoint commit missing in storage, and clear on the next user input. `/rewind` continues to report missing code-restore storage through its command UI while keeping conversation restore available.

  For `@ayulab/pi-checkpoint`, checkpoint storage deletion now treats an already-removed storage directory as a successful delete after path, manifest, and active-session safety checks have passed, avoiding stale-selector `ENOENT` failures.

### Patch Changes

- Updated dependencies [a9a2e1f]
  - @ayulab/pi-checkpoint@0.6.0

## 0.3.8

### Patch Changes

- e8c2a98: Finish phase 1 of the checkpoint storage fix:

  - harden checkpoint restore preflight with fail-closed checkout behavior and clearer restore failure handling
  - expand built-in checkpoint excludes, add `ayu.checkpoint.include`, and add opt-in `ayu.checkpoint.maxFileMB`
  - make resume conversation-only by default with `restoreOnResume: "never"`, while keeping `/tree` conversation-first and preserving fork and clone restore defaults
  - add `/checkpoint` storage management with per-storage manifests, orphan detection, and explicit delete
  - document the phase 1 nested Git repository boundary and storage-management behavior
  - refresh workspace development typing to `@types/node@26`

- Updated dependencies [e8c2a98]
  - @ayulab/pi-checkpoint@0.5.4

## 0.3.7

### Patch Changes

- 7392ebc: Refresh checkpoint exclude rules for existing and cloned storage, refresh auto-discovered embedded Git repository excludes before each staging operation, ignore nested node_modules directories by default, and remove already-indexed ignored entries from checkpoint indexes.

  This prevents broad workspace checkpoints and fork/clone restores from indexing embedded repositories or cleaning excluded work tree content.

- Updated dependencies [7392ebc]
  - @ayulab/pi-checkpoint@0.5.3

## 0.3.6

### Patch Changes

- e374280: Updated workspace dependency versions to their latest releases.
- Updated dependencies [e374280]
- Updated dependencies [62257b5]
  - @ayulab/pi-checkpoint@0.5.2

## 0.3.5

### Patch Changes

- Updated dependencies [8c7fe78]
  - @ayulab/pi-checkpoint@0.5.1

## 0.3.4

### Patch Changes

- 0225397: fix(pi-rewind): show Sync files? dialog in ask mode when userWantsSummary is undefined or false

  Commit 686f64a moved `finalizeCheckpointForSession` and live checkpoint
  scanning before the `userWantsSummary` check so pending checkpoints are
  flushed before the dialog appears. However the guard
  `userWantsSummary !== false` still skipped the ask-mode dialog whenever
  the value was true (Summarize) or undefined (legacy / missing field).

  - Change the guard to `userWantsSummary === true` so that only an
    explicit "Summarize" choice skips the file-restore path; undefined or
    false values now let restoreOnTree settings apply.
  - Add a regression test confirming ask-mode does NOT prompt when the
    user explicitly chooses to summarise.

  Resulting behaviour by mode:

  ask + No summary → prompt "Sync files?" when session has changes
  ask + Summarize → no prompt, behave like native /tree
  always + No summary → restore files without prompting
  always + Summarize → no file restore, behave like native /tree
  never (any value) → no file restore, behave like native /tree

## 0.3.3

### Patch Changes

- b21b4b7: Keep `restoreOnTree: "ask"` sync prompts enabled after any checkpoint in the current session changes files.
- b21b4b7: Fix Sync files? dialog not appearing in ask mode when file changes occur during an ask-session. The extension now finalizes pending checkpoints before tree navigation and correctly detects file changes in both live and session-resolved checkpoint entries. Also documents that pressing Esc in the Sync files? dialog is equivalent to selecting No.

## 0.3.2

### Patch Changes

- c339a13: Add locked checkpoint APIs and safe session checkpoint storage helpers to reduce repo-race issues in `pi-rewind` and support safer extension/runtime checkpoint workflows.
- 6b44c21: Clarify the local install and uninstall workflow for `pi install /path/to/oh-my-pi` and `pi uninstall /path/to/oh-my-pi`, and document the `pnpm run setup` / `pnpm run teardown` development workflow.
- Updated dependencies [c339a13]
  - @ayulab/pi-checkpoint@0.5.0

## 0.3.1

### Patch Changes

- 97c0872: Improve pi-rewind checkpoint navigation with a tree-style `/rewind` selector, full prompt metadata preservation, and smarter `/tree` sync prompting that skips file restore prompts when checkpoints have no file changes.
- 6db8ed0: Align `ayu` settings merging with recursive project/user config handling, refresh package metadata and docs, and add git hook automation.
- Updated dependencies [97c0872]
- Updated dependencies [6db8ed0]
  - @ayulab/pi-checkpoint@0.4.1

## 0.3.0

### Minor Changes

- 633b275: Update Rewind tree sync behavior, improve checkpoint runtime support, and migrate package releases to Changesets.

  This release simplifies Rewind restore modes, keeps native no-summary tree navigation intact, adds optional file sync during tree navigation, and updates the curated root package/release workflow for Changesets-managed publishing.

### Patch Changes

- Updated dependencies [633b275]
  - @ayulab/pi-checkpoint@0.4.0
