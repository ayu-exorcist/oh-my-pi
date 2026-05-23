# Context Map

## Contexts

- [Checkpoint Engine](./sdk/pi-checkpoint/CONTEXT.md) — Git bare repo snapshot engine. Manages file-level checkpoints via commits, diffs, checkout, and cross-process locking.
- [Rewind Extension](./extensions/pi-rewind/CONTEXT.md) — Automatic per-turn checkpoint hooks and the `/rewind` command for interactive checkpoint navigation.
- [UndoRedo Extension](./extensions/pi-undoredo/CONTEXT.md) — `/undo` and `/redo` commands with in-memory redo stack management.

## Relationships

- **Checkpoint Engine → Rewind Extension**: Rewind depends on Checkpoint Engine for `RepoManager`, config loading, diff parsing, and `CheckpointEntry` extraction.
- **Checkpoint Engine → UndoRedo Extension**: UndoRedo depends on Checkpoint Engine for `RepoManager`, `RepoProvider`, and `CheckpointEntry` reading. It does not create checkpoints; it consumes entries written by Rewind (or any other checkpoint-aware extension).
- **Rewind Extension ↔ UndoRedo Extension**: Both operate on the same Pi session entries. Rewind writes `CheckpointEntry` v2 custom entries; UndoRedo reads them. The redo stack is private to UndoRedo.
