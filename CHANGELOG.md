# @ayulab/oh-my-pi

## 0.4.11

### Patch Changes

- Updated dependencies [d20e1b0]
  - @ayulab/pi-rewind@0.4.1

## 0.4.10

### Patch Changes

- Updated dependencies [a9a2e1f]
  - @ayulab/pi-rewind@0.4.0

## 0.4.9

### Patch Changes

- 35065fc: Bump version after unpublish conflict.

## 0.4.8

### Patch Changes

- e8c2a98: Finish phase 1 of the checkpoint storage fix:

  - harden checkpoint restore preflight with fail-closed checkout behavior and clearer restore failure handling
  - expand built-in checkpoint excludes, add `ayu.checkpoint.include`, and add opt-in `ayu.checkpoint.maxFileMB`
  - make resume conversation-only by default with `restoreOnResume: "never"`, while keeping `/tree` conversation-first and preserving fork and clone restore defaults
  - add `/checkpoint` storage management with per-storage manifests, orphan detection, and explicit delete
  - document the phase 1 nested Git repository boundary and storage-management behavior
  - refresh workspace development typing to `@types/node@26`

- Updated dependencies [e8c2a98]
  - @ayulab/pi-rewind@0.3.8

## 0.4.7

### Patch Changes

- 7392ebc: Refresh checkpoint exclude rules for existing and cloned storage, refresh auto-discovered embedded Git repository excludes before each staging operation, ignore nested node_modules directories by default, and remove already-indexed ignored entries from checkpoint indexes.

  This prevents broad workspace checkpoints and fork/clone restores from indexing embedded repositories or cleaning excluded work tree content.

- Updated dependencies [7392ebc]
  - @ayulab/pi-rewind@0.3.7

## 0.4.6

### Patch Changes

- e374280: Updated workspace dependency versions to their latest releases.
- 62257b5: Remove retired private extension references from the published package docs and refresh the pi-checkpoint README with the current export surface and restore configuration guidance.
- Updated dependencies [e374280]
  - @ayulab/pi-rewind@0.3.6

## 0.4.5

### Patch Changes

- @ayulab/pi-rewind@0.3.5

## 0.4.4

### Patch Changes

- Updated dependencies [0225397]
  - @ayulab/pi-rewind@0.3.4

## 0.4.3

### Patch Changes

- b21b4b7: - fix: remove `run` prefix from `pnpm changeset` commands in publish scripts (`pnpm changeset status` / `pnpm changeset publish` instead of `pnpm run changeset ...`)
  - ci: add `paths` filter to `prepare-release-pr.yml` workflow to trigger only on `.changeset/*.md` changes
- Updated dependencies [b21b4b7]
- Updated dependencies [b21b4b7]
  - @ayulab/pi-rewind@0.3.3

## 0.4.2

### Patch Changes

- c339a13: Add locked checkpoint APIs and safe session checkpoint storage helpers to reduce repo-race issues in `pi-rewind` and support safer extension/runtime checkpoint workflows.
- 6b44c21: Clarify the local install and uninstall workflow for `pi install /path/to/oh-my-pi` and `pi uninstall /path/to/oh-my-pi`, and document the `pnpm run setup` / `pnpm run teardown` development workflow.
- Updated dependencies [c339a13]
- Updated dependencies [6b44c21]
  - @ayulab/pi-rewind@0.3.2

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
