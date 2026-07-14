# @ayulab/pi-checkpoint

File-level checkpoint engine powered by git bare repositories. Usable as an SDK Package dependency for Pi extensions.

## Features

- **Checkpoint Storage**: resolve, create, or clone the on-disk git bare repository for a Pi session
- **Metadata persistence**: read `CheckpointEntry` metadata stored as Pi session custom entries
- **Fork support**: clone Checkpoint Storage when a Pi session forks
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
  deleteSessionCheckpointStorage,
  getCheckpointEntries,
  getCheckpointSessionsRoot,
  getGitDir,
  getIndexPath,
  getRepoDir,
  isCheckpointEntry,
  loadConfig,
  loadConfigFromFile,
  listCheckpointStorageManifests,
  parseDiffStats,
  readCheckpointStorageManifest,
  RepoManager,
  resolveSessionCheckpointStorage,
  safeCloneSessionCheckpointStorage,
  safeEnsureSessionCheckpointStorage,
  safeRestore,
  SessionStateMap,
  withRepoLock,
  writeCheckpointStorageManifest,
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

Use Checkpoint Storage as the cross-package seam. It is based on the session file path and work tree, not on shared in-memory state, so separately installed Pi Packages can interoperate.

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

const beforeCommit = await storage.repo.checkpoint(entryId);
```

Fork handlers clone storage from a previous session:

```typescript
const storage = await safeCloneSessionCheckpointStorage({
  previousSessionFile,
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
  exclude: config.exclude,
});

if (storage.ok) {
  await storage.repo.checkoutCommit(forkPoint.beforeCommit);
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
      "restoreOnFork": false,
      "restoreOnClone": false,
      "restoreOnResume": false,
      "restoreOnTree": false,
      "defaultSummaryInstructions": "",
      "exclude": ["tmp/generated/**"],
      "include": ["tmp/generated/keep-me.txt"],
      "maxFileMB": 25
    },
    "rewind": {
      "restoreOnTree": "ask"
    }
  }
}
```

For example, keep shared checkpoint defaults in `~/.pi/agent/settings.json` and override only the fields you need in `.pi/settings.json`.

The SDK config type accepts booleans for checkpoint restore settings. `restoreOnFork`, `restoreOnClone`, `restoreOnResume`, and `restoreOnTree` all default to `false`. Product-level `/tree` policy such as `"always" | "ask" | "never"` lives in `ayu.rewind.restoreOnTree`; `pi-rewind` defaults that policy to `"ask"`.

### Exclude behavior

When the work tree is inside a Git repository, Checkpoint staging respects its Git ignore rules, including root and nested `.gitignore` files. Outside a Git repository, `.gitignore` is treated as an ordinary file, so its matching files and directories are checkpoint-managed. Checkpoint Storage also writes its own internal excludes to the bare repo's `info/exclude` before staging; these rules are not written to the user's project `.git`.

The internal excludes cover high-cost or unsafe paths such as `node_modules`, generated build output, common cache directories, personal IDE state, operating-system metadata files, and auto-detected nested Git repository roots. Built-in excludes run first, `ayu.checkpoint.exclude` appends more excludes, and `ayu.checkpoint.include` re-includes explicit paths afterward. `.pi/`, `.vscode/`, `vendor/`, `*.iml`, and `*.d.ts` are not excluded by default; only high-confidence personal IDE files such as `.idea/workspace.xml`, `.idea/tasks.xml`, `.idea/caches/`, `.idea/shelf/`, `.idea/localHistory/`, `.idea/compile-server/`, plus operating-system metadata such as `.DS_Store`, `Thumbs.db`, `Desktop.ini`, `*.iws`, `*.swp`, and `*.swo` are excluded automatically, including when those files appear inside nested project directories.

On Windows, Checkpoint also force-excludes reserved device-name paths such as `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, and `LPT1`–`LPT9`, including case variants, extensions, and nested paths. These paths are not checkpoint-managed, and neither `ayu.checkpoint.include` nor a project `.gitignore` negation can re-include them. Existing Checkpoint commits are not rewritten.

For example, if a session is opened at `Desktop` and `Desktop/project-a/.git` exists, the `project-a/` directory is excluded from the `Desktop` Checkpoint. `/rewind` still works for non-excluded files in `Desktop`, but it will not restore files inside `project-a/` from that outer session. If the session is opened directly at `Desktop/project-a`, that repository is the work tree root and is protected normally except for configured excludes.

This avoids Git indexing embedded repositories as gitlinks and keeps restore behavior scoped to one work tree. Cloned Checkpoint Storage should receive the same exclude list before any checkout or restore so `git clean` keeps excluded work tree content protected. To protect a nested repository's files, open a Pi session in that repository root.

`ayu.checkpoint.maxFileMB` is opt-in. When set, oversized changed files are skipped during checkpoint staging; by default no file-size limit is applied.

### Storage manifests

Each session storage directory now carries its own `manifest.json` with the session id, session file, cwd, first user message, and timestamps. This keeps storage metadata local to each repo and avoids a global registry write hotspot. Extensions can list manifest-backed storage with `listCheckpointStorageManifests()`, read or update manifests directly, and delete a non-active storage directory with `deleteSessionCheckpointStorage()` after their own UI confirms the action.

`deleteSessionCheckpointStorage()` is the strict path: it requires checkpoint-root path safety, refuses the caller-provided active session, and expects both a manifest and a healthy bare `.git` directory before removal. It does not detect whether a different Pi process is using the same storage; callers that need cross-process usage protection must add their own lease or busy-check policy. Once the safety checks pass, deletion is idempotent if the directory has already disappeared before the final removal step. Delete failures are returned as `{ ok: false, reason: "delete-failed" }` instead of being thrown so callers can surface a non-fatal UI error. For orphan cleanup, use `purgeSessionCheckpointStorage()` when the session record is already gone or the residual storage is partially corrupt. That path still enforces checkpoint-root path safety and current-session protection, but it does not require a healthy bare repo before removing the directory.

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
