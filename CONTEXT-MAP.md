# Context Map

## Contexts

- [Checkpoint Engine](./sdk/pi-checkpoint/CONTEXT.md) — Git bare repo snapshot engine. Manages file-level checkpoints via commits, diffs, checkout, and cross-process locking.
- [Rewind Extension](./extensions/pi-rewind/CONTEXT.md) — Automatic per-turn checkpoint hooks and the `/rewind` command for interactive checkpoint navigation.
- Project collaboration and release rules are documented in `AGENTS.md` and `CONTRIBUTING.md`.

## Relationships

- **Checkpoint Engine → Rewind Extension**: Rewind depends on Checkpoint Engine for `RepoManager`, config loading, diff parsing, and `CheckpointEntry` extraction.
