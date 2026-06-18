# @ayulab/pi-rewind

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
