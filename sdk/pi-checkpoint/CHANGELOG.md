# @ayulab/pi-checkpoint

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
