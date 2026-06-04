# @ayulab/pi-checkpoint

File-level checkpoint engine powered by git bare repositories. Usable as an SDK Package dependency for Pi extensions.

## Features

- **Checkpoint Storage**: resolve, create, or clone the on-disk git bare repository for a Pi session
- **Metadata persistence**: read `CheckpointEntry` metadata stored as Pi session custom entries
- **Fork support**: clone Checkpoint Storage when a Pi session forks
- **Restore**: safely checkout to any previous Checkpoint's code state
- **Zero runtime dependencies**: relies only on Node.js built-ins and system git

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
  loadConfig,
  loadConfigFromFile,
  defaultConfig,
  resolveSessionCheckpointStorage,
  ensureSessionCheckpointStorage,
  cloneSessionCheckpointStorage,
  RepoManager,
  parseDiffStats,
  extractCheckpointData,
  filterCheckpointEntries,
  getCheckpointEntries,
  isCheckpointEntry,
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
const storage = await ensureSessionCheckpointStorage({
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
  exclude: config.exclude,
});

const beforeCommit = await storage.repo.checkpoint(entryId);
```

Fork handlers clone storage from a previous session:

```typescript
const storage = await cloneSessionCheckpointStorage({
  previousSessionFile,
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
});

if (storage.ok) {
  await storage.repo.checkoutCommit(forkPoint.beforeCommit);
}
```

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

Via `.pi/settings.json` or `~/.pi/agent/settings.json`. Checkpoint engine settings live under `checkpoint`; Ayu extension behavior settings live under top-level `ayu`.

```json
{
  "checkpoint": {
    "enabled": true,
    "autoCheckpoint": true,
    "restoreOnFork": "always",
    "restoreOnClone": "always",
    "restoreOnResume": "always",
    "defaultSummaryInstructions": "",
    "exclude": ["node_modules/", ".git/", "*.log"]
  },
  "ayu": {
    "rewind": {
      "restoreOnTree": "never"
    }
  }
}
```

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
