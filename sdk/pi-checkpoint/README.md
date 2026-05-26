# @ayulab/pi-checkpoint

File-level checkpoint engine powered by git bare repositories. Usable standalone or as a dependency for other Pi extensions.

## Features

- **Auto checkpoint**: create code snapshots automatically on every user turn
- **Metadata persistence**: checkpoint metadata stored as Pi session custom entries
- **Fork / clone support**: auto-copy checkpoint repo on session fork or clone
- **Restore**: checkout to any previous checkpoint's code state
- **Zero runtime dependencies**: relies only on Node.js built-ins and system git

## Installation

Standalone:

```bash
pi install npm:@ayulab/pi-checkpoint
```

Or as a dependency of another extension:

```json
{
  "dependencies": {
    "@ayulab/pi-checkpoint": "workspace:*"
  }
}
```

## API

```typescript
import {
  loadConfig,
  loadConfigFromFile,
  defaultConfig,
  RepoManager,
  getRepoDir,
  getGitDir,
  getIndexPath,
  exec,
  execSafe,
  parseDiffStats,
  withRepoLock,
  createDefaultRepoProvider,
  extractCheckpointData,
  filterCheckpointEntries,
  getCheckpointEntries,
  isCheckpointEntry,
} from "@ayulab/pi-checkpoint";
```

### RepoManager

Manage the lifecycle of a git bare repo:

```typescript
const repo = new RepoManager(gitDir, indexFile, cwd);
await repo.init();
const hash = await repo.checkpoint(entryId);
await repo.checkoutCommit(hash);
await repo.setExclude(["node_modules/", ".git/"]);
const stats = await repo.diffStats(hash);
const result = await repo.safeCheckout(targetCommit, dirtyBaseCommit);
```

### Checkpoint entries

Read checkpoint metadata written by extensions as Pi session custom entries:

```typescript
const dataList = extractCheckpointData(sessionEntries);
const checkpoints = filterCheckpointEntries(dataList);
```

## Configuration

Via `.pi/settings.json` or `~/.pi/agent/settings.json`:

```json
{
  "enabled": true,
  "autoCheckpoint": true,
  "restoreOnTree": "never",
  "restoreOnFork": "always",
  "restoreOnClone": "never",
  "restoreOnResume": "never",
  "defaultSummaryInstructions": "",
  "exclude": ["node_modules/", ".git/", "*.log"]
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
