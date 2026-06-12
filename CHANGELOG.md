# @ayulab/oh-my-pi

## 0.4.1

### Patch Changes

- 97c0872: Improve pi-rewind checkpoint navigation with a tree-style `/rewind` selector, full prompt metadata preservation, and smarter `/tree` sync prompting that skips file restore prompts when checkpoints have no file changes.
- 6db8ed0: Align `ayu` settings merging with recursive project/user config handling, refresh package metadata and docs, and add git hook automation.
- Updated dependencies [97c0872]
- Updated dependencies [6db8ed0]
  - @ayulab/pi-rewind@0.3.1

## 0.4.0

### Minor Changes

- 633b275: Update Rewind tree sync behavior, improve checkpoint runtime support, and migrate package releases to Changesets.

  This release simplifies Rewind restore modes, keeps native no-summary tree navigation intact, adds optional file sync during tree navigation, and updates the curated root package/release workflow for Changesets-managed publishing.

### Patch Changes

- Updated dependencies [633b275]
  - @ayulab/pi-rewind@0.3.0

## 0.3.4

### Patch Changes

- bb2fa92: Stop bundling unpublished pi-brief and pi-clarify extensions while they remain in development.
