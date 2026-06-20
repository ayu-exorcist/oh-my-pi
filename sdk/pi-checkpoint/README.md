# @ayulab/pi-checkpoint

File-level checkpoint engine powered by git bare repositories. Usable as an SDK Package dependency for Pi extensions.

## Features

- **Worktree Checkpoint Storage**: resolve or create the shared on-disk git bare repository for a work tree
- **Metadata persistence**: read `CheckpointEntry` metadata stored as Pi session custom entries
- **Fork support**: reuse shared Worktree Checkpoint Storage when a Pi session forks in the same work tree
- **Restore**: safely checkout to any previous Checkpoint's code state
- **No external runtime dependencies**: bundled with private runtime helpers, and relies on Node.js built-ins plus system git

## Installation

As a dependency of a Pi Package:

```json
{
  "dependencies": {
    "@ayulab/pi-checkpoint": "workspace:*"
  }
}
```

`@ayulab/pi-checkpoint` is an SDK Package. It does not register Pi resources by itself.

## API

```typescript
import {
  bindSessionRepo,
  cloneSessionCheckpointStorage,
  createDefaultRepoProvider,
  defaultConfig,
  ensureSessionCheckpointStorage,
  exec,
  execSafe,
  extractCheckpointData,
  filterCheckpointEntries,
  getCheckpointEntries,
  cleanupLegacySessionCheckpointStorage,
  createCheckpointRef,
  getCheckpointRootDir,
  getGitDir,
  getIndexPath,
  getLegacySessionsDir,
  getRepoDir,
  getWorktreeId,
  getWorktreeRegistryPath,
  isCheckpointEntry,
  loadConfig,
  loadConfigFromFile,
  parseDiffStats,
  RepoManager,
  resolveSessionCheckpointStorage,
  safeCloneSessionCheckpointStorage,
  safeEnsureSessionCheckpointStorage,
  safeRestore,
  SessionStateMap,
  withRepoLock,
} from "@ayulab/pi-checkpoint";

import type {
  CheckpointConfig,
  CheckpointEntry,
  CheckpointMeta,
  CloneSessionCheckpointStorageOptions,
  CloneSessionCheckpointStorageResult,
  EnsureSessionCheckpointStorageOptions,
  ExecEnv,
  FileChange,
  NavigateTreeOptions,
  NavigateTreeResult,
  RepoProvider,
  RestoreResult,
  Result,
  SafeCheckoutResult,
  SessionCheckpointStorageOptions,
  SessionCheckpointStorageResult,
} from "@ayulab/pi-checkpoint";
```

### Checkpoint Storage

Use Worktree Checkpoint Storage as the cross-package seam. It is based on the resolved work tree real path, not on shared in-memory state, so separately installed Pi Packages can interoperate and sessions in the same project share git objects.

New storage is written under:

```text
~/.pi/agent/ayu/checkpoints/
  worktrees.json
  worktrees/<worktree-id>/repo.git
  worktrees/<worktree-id>/index
  worktrees/<worktree-id>/metadata.json
  worktrees/<worktree-id>/lock/
```

The old per-session storage path `~/.pi/agent/ayu/checkpoints/sessions/` is legacy-only and may be removed by startup cleanup. Old sessions keep their conversation history, but old file snapshots from that path are not migrated or cloned into Worktree Checkpoint Storage.

Checkpoint Consumers resolve existing storage without creating it:

```typescript
const storage = await resolveSessionCheckpointStorage({
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
});

if (!storage.ok) {
  ctx.ui.notify(
    "Checkpoint storage not found. This session has checkpoints, but their file snapshots are missing.",
    "warning",
  );
  return;
}

const result = await storage.repo.safeCheckout(targetCommit, dirtyBaseCommit);
```

Checkpoint Producers create storage when missing:

```typescript
const storage = await safeEnsureSessionCheckpointStorage({
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
  exclude: config.exclude,
});

const beforeState = await storage.repo.checkpoint(entryId);
```

Fork handlers resolve the shared storage for the work tree:

```typescript
const storage = await safeCloneSessionCheckpointStorage({
  previousSessionFile,
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
  exclude: config.exclude,
});

if (storage.ok) {
  const result = await storage.repo.safeCheckout(forkPoint.beforeState, dirtyBaseState);
  if (!result.ok) {
    // Handle dirty / dirty-check-failed / checkout-failed before continuing.
  }
}
```

### API Layers

- `locked*` methods are single-step convenience entry points, such as `lockedCheckpoint()`, `lockedStageAll()`, `lockedCheckoutCommit()`, `lockedUpdateRef()`, `lockedInit()`, and `lockedSetExclude()`.
- `safe*` methods wrap complete flows with their own safety semantics, such as `safeCheckout()`, `safeEnsureSessionCheckpointStorage()`, and `safeCloneSessionCheckpointStorage()`.
- Raw primitives such as `checkpoint()`, `stageAll()`, `checkoutCommit()`, `updateRef()`, `init()`, `setExclude()`, `cloneFrom()`, and `withLock()` stay available for advanced composition.

### RepoManager

`RepoManager` is the lower-level git implementation behind Checkpoint Storage:

```typescript
const hash = await storage.repo.checkpoint(entryId);
const stats = await storage.repo.diffStats(hash);
const result = await storage.repo.safeCheckout(targetCommit, dirtyBaseCommit);
```

Prefer Checkpoint Storage helpers over constructing `RepoManager` directly from repo paths in Pi Package code.

### Checkpoint entries

Read checkpoint metadata written by extensions as Pi session custom entries:

```typescript
const checkpoints = getCheckpointEntries(ctx.sessionManager.getEntries());
```

Or in two steps:

```typescript
const dataList = extractCheckpointData(sessionEntries);
const checkpoints = filterCheckpointEntries(dataList);
```

## Configuration

Via `.pi/settings.json` or `~/.pi/agent/settings.json`. Checkpoint engine settings live under `ayu.checkpoint`; Ayu extension behavior settings live under `ayu.rewind`.

`ayu` is merged recursively across scopes: project settings override user settings field-by-field, and missing values fall back to defaults. Checkpoint settings must be nested under `ayu.checkpoint`; top-level `checkpoint` settings are ignored.

```json
{
  "ayu": {
    "checkpoint": {
      "enabled": true,
      "autoCheckpoint": true,
      "restoreOnFork": "always",
      "restoreOnClone": "always",
      "restoreOnResume": "never",
      "defaultSummaryInstructions": "",
      "exclude": ["project-specific-generated/**"],
      "retention": {
        "enabled": true,
        "maxAge": "30d",
        "minRetention": "1d"
      }
    },
    "rewind": {
      "restoreOnTree": "never"
    }
  }
}
```

For example, keep shared checkpoint defaults in `~/.pi/agent/settings.json` and override only the fields you need in `.pi/settings.json`. `ayu.checkpoint.maxFileBytes` is unset by default, matching Gemini CLI checkpointing's git-backed behavior; set it only if a project needs an explicit per-file checkpoint cap.

The SDK config type accepts `"always"`, `"ask"`, and `"never"` for fork, clone, and resume restore settings. `restoreOnResume` now defaults to `"never"` so resuming a conversation is conversation-first and does not modify files unless users opt back into `"always"`. Fork and clone remain `"always"` by default because they are explicit branch-entry actions.

### Exclude behavior

Checkpoint staging respects Git ignore rules from the work tree, including root and nested `.gitignore` files. Checkpoint Storage also writes its own internal excludes to the bare repo's `info/exclude` before staging; these rules are not written to the user's project `.git`.

`ayu.checkpoint.exclude` appends project-specific patterns to built-in defaults. It does not replace the defaults. Built-in defaults cover generated/dependency/cache/build paths such as `.git/`, `.pi/`, `node_modules/`, `.gradle/`, `.ark/`, `.next/`, `.vite/`, `.turbo/`, `dist/`, `build/`, `target/`, `coverage/`, Python caches, mobile build caches, Terraform/serverless caches, IDE folders, logs, temp files, `.DS_Store`, and `Thumbs.db`. `vendor/` and `*.d.ts` are intentionally not default-excluded because they may contain source files.

File restore is exact only for checkpoint-managed files: files under the session cwd minus built-in excludes, user excludes, Git ignored files, and files above `ayu.checkpoint.maxFileBytes` when that optional limit is configured. Ignored, excluded, and configured-over-limit files are outside the restore commitment and do not block restore.

The internal excludes cover high-cost or unsafe paths such as `node_modules`, generated build output, and auto-detected nested Git repository roots. For example, if a session is opened at `Desktop` and `Desktop/project-a/.git` exists, the `project-a/` directory is excluded from the `Desktop` Checkpoint. `/rewind` still works for non-excluded files in `Desktop`, but it will not restore files inside `project-a/` from that outer session. If the session is opened directly at `Desktop/project-a`, that repository is the work tree root and is protected normally except for configured excludes.

This avoids Git indexing embedded repositories as gitlinks and keeps restore behavior scoped to one work tree. Cloned or reused Checkpoint Storage should receive the same exclude list before any checkout or restore so `git clean` keeps excluded work tree content protected. To protect a nested repository's files, open a Pi session in that repository root.

Dirty guard fails closed: if checkpoint-managed files differ from the selected clean checkpoint, restore returns `dirty`; if the diff/status/index check itself fails, restore returns `dirty-check-failed` and no checkout is attempted. Restore preserves currently ignored or excluded files even if an old retained checkpoint commit still contains them, because those paths are outside the current restore commitment.

`pi-rewind` exposes `/checkpoint cleanup` as a dry-run manual cleanup command. The dry run shows counts and sample refs for orphan and retention-expired file states before deleting anything. `/checkpoint cleanup --apply` removes legacy per-session checkpoint storage, deletes orphan and retention-expired checkpoint refs, expires checkpoint reflogs, and runs git GC for affected Worktree Checkpoint Storage. Checkpoint commits are parentless states protected by explicit refs instead of permanent branch history, so once refs are removed their file objects can be reclaimed. Cleanup does not delete Pi conversation history or protected active worktree storage, and it fails closed if live session scanning, ref validation, path validation, or cleanup preflight cannot be verified.

### Design note: changed-path capture

A possible future architecture is a changed-path log with before/after content capture. Instead of staging the whole work tree, the engine would record paths touched during a Turn and persist the pre-Turn and post-Turn content or deletion state only for those paths. That could reduce scanning cost for broad workspaces and may support richer multi-root behavior.

This is not the current default because arbitrary shell commands can modify files outside the agent's direct edit tools. A correct implementation would need reliable write detection, likely through a filesystem watcher, platform journal, or command sandbox, plus restore semantics for deletes, renames, binary files, permissions, dirty guards, and rollback. Until those pieces exist, git-backed Checkpoint Storage remains the source of truth, with internal excludes used to avoid known unsafe or ambiguous paths.

## Development

```bash
pnpm run build     # tsdown bundle into dist/
pnpm run dev       # watch mode
pnpm test          # run tests
pnpm run coverage  # coverage report
pnpm run typecheck # tsc --noEmit
```

## License

GPL-3.0
