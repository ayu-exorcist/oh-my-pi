# @ayulab/pi-rewind

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
