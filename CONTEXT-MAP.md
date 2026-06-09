# Context Map

## Contexts

- [Checkpoint Engine](./sdk/pi-checkpoint/CONTEXT.md) — Git bare repo snapshot engine. Manages file-level checkpoints via commits, diffs, checkout, and cross-process locking.
- [Clarify Extension](./extensions/pi-clarify/CONTEXT.md) — `ask_user` structured one-question clarification tool and `/clarify` demo/status command.
- [Brief Extension](./extensions/pi-brief/CONTEXT.md) — One-line brief summaries for built-in tool output. Pairs with Clarify to keep decision prompts visible amid exploration noise.
- [Rewind Extension](./extensions/pi-rewind/CONTEXT.md) — Automatic per-turn checkpoint hooks and the `/rewind` command for interactive checkpoint navigation.
- [UndoRedo Extension](./extensions/pi-undo-redo/CONTEXT.md) — `/undo` and `/redo` commands with in-memory redo stack management.
- Project harness rules are documented inline in `AGENTS.md` and `README.md`.

## Relationships

- **Clarify Extension ↔ Other Extensions**: Clarify is independent of Write Mode and checkpointing. Other extensions and agents can use `ask_user` for structured user decisions without gaining write permissions.
- **Brief Extension ↔ Clarify Extension**: Brief reduces exploration noise so Clarify decision prompts stand out. Brief does not modify Clarify rendering or behavior.
- **Checkpoint Engine → Rewind Extension**: Rewind depends on Checkpoint Engine for `RepoManager`, config loading, diff parsing, and `CheckpointEntry` extraction.
- **Checkpoint Engine → UndoRedo Extension**: UndoRedo depends on Checkpoint Engine for `RepoManager`, `RepoProvider`, and `CheckpointEntry` reading. It does not create checkpoints; it consumes entries written by Rewind (or any other checkpoint-aware extension).
- **Rewind Extension ↔ UndoRedo Extension**: Both operate on the same Pi session entries. Rewind writes `CheckpointEntry` custom entries; UndoRedo reads them. The redo stack is private to UndoRedo.
