# Context Map

## Contexts

- [Checkpoint Engine](./sdk/pi-checkpoint/CONTEXT.md) — Git bare repo snapshot engine. Manages file-level checkpoints via commits, diffs, checkout, and cross-process locking.
- [Trace Engine](./sdk/pi-trace-engine/CONTEXT.md) — AI Engineering trace collection, analysis, and storage engine. Zero Pi runtime dependencies.
- [Write Gate Extension](./extensions/pi-write-gate/CONTEXT.md) — Write authorization gate, editor label, system prompt injection, and `/write-gate` controls.
- [Clarify Extension](./extensions/pi-clarify/CONTEXT.md) — `ask_user` structured one-question clarification tool and `/clarify` demo/status command.
- [Workflow Extension](./extensions/pi-workflow/CONTEXT.md) — `/ayu` workflow prompt router for task planning, review, docs sync, release checks, verification, and audits.
- [Rewind Extension](./extensions/pi-rewind/CONTEXT.md) — Automatic per-turn checkpoint hooks and the `/rewind` command for interactive checkpoint navigation.
- [UndoRedo Extension](./extensions/pi-undo-redo/CONTEXT.md) — `/undo` and `/redo` commands with in-memory redo stack management.
- [Trace Lab Extension](./extensions/pi-trace-lab/CONTEXT.md) — AI Engineering trace collection, structured session review, pattern clustering, and harness self-iteration.
- [AI Harness](./docs/agents/ai-harness.md) — Project-local agent operating model: side-effect tiers, capability review, MCP/package safety, browser/sandbox policy, checkpoint safety, and release gates.

## Relationships

- **Write Gate Extension ↔ Other Extensions**: Write Gate is independent of checkpoint packages. It may block mutating tool calls before Rewind or UndoRedo-related edits run unless Write Mode is On.
- **Clarify Extension ↔ Other Extensions**: Clarify is independent of Write Mode and checkpointing. Other extensions and agents can use `ask_user` for structured user decisions without gaining write permissions.
- **Ayu Workflow Extension → Write Gate Extension**: Workflow prompts are independent from Write Mode state. Use Write Gate for write authorization and `/ayu` for planning/review/verification prompts.
- **Checkpoint Engine → Rewind Extension**: Rewind depends on Checkpoint Engine for `RepoManager`, config loading, diff parsing, and `CheckpointEntry` extraction.
- **Checkpoint Engine → UndoRedo Extension**: UndoRedo depends on Checkpoint Engine for `RepoManager`, `RepoProvider`, and `CheckpointEntry` reading. It does not create checkpoints; it consumes entries written by Rewind (or any other checkpoint-aware extension).
- **Rewind Extension ↔ UndoRedo Extension**: Both operate on the same Pi session entries. Rewind writes `CheckpointEntry` custom entries; UndoRedo reads them. The redo stack is private to UndoRedo.
- **Trace Engine → Trace Lab Extension**: Trace Lab depends on Trace Engine for `TurnCollector`, `SessionCollector`, signal detection, and `StorageManager`. It adds Pi-specific event bindings and TUI on top.
- **Checkpoint Engine → Trace Lab Extension**: Trace Lab depends on Checkpoint Engine for `SessionStateMap` to manage per-session collector instances.
