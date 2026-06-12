# @ayulab/pi-rewind

Pi extension providing the `/rewind` interactive checkpoint navigation command.

## Features

- Interactive checkpoint list with file-change statistics
- Rewind restores a selected prompt to its pre-run code state (`beforeCommit`), so the turn can be run again
- Restore options for checkpoints with file changes:
  1. Restore code and conversation
  2. Restore conversation
  3. Restore code
- Conversation-only restore option when the checkpoint list has no file changes
- Optional file-state sync when navigating the Pi session tree (`ayu.rewind.restoreOnTree`) with `never`, `ask`, and `always` modes
- Auto-copy checkpoint storage on fork; clone can restore code to the selected checkpoint's `afterCommit` when `restoreOnClone` is enabled
- File-change stats shown for each checkpoint in the selection list
- Bundled checkpoint engine is emitted as a deterministic `@ayulab__pi-checkpoint.js` chunk for Pi package loading

## Dependencies

- `@ayulab/pi-checkpoint` — checkpoint engine
- `@earendil-works/pi-coding-agent` — Pi Extension API

## Installation

As part of the curated collection:

```bash
pi install npm:@ayulab/oh-my-pi
```

Or standalone:

```bash
pi install npm:@ayulab/pi-rewind
```

## Usage

The extension registers automatically after Pi starts, and captures checkpoints around each turn.

Use `/rewind` to jump back to any earlier turn and choose the exact restore scope you want:

- **Restore code and conversation** — roll both the workspace and the conversation back to the selected checkpoint
- **Restore conversation** — revisit an earlier idea without touching files
- **Restore code** — bring files back while keeping the current conversation position

It fits the moments when you want to:

- retry a prompt after fixing the code it generated
- inspect an earlier branch of thought without changing the workspace
- restore files from a checkpoint while staying on the current conversation path
- use `/tree` for navigation and only restore files when `ayu.rewind.restoreOnTree` is `ask` or `always`

```
> /rewind

Recent checkpoints:
[1] (current)

[2] add tests
   src/auth.test.ts +1 -0

[3] refactor auth
   2 files changed  +6 -2

Select checkpoint: 2
Restore mode:
[1] Restore code and conversation
[2] Restore conversation
[3] Restore code

Select mode: 1
✓ Rewind completed
```

## Configuration

`pi-rewind` reads its settings from `ayu.rewind`, while checkpoint behavior comes from `ayu.checkpoint`. The `ayu` tree is merged recursively across scopes, so project settings override user settings field-by-field and missing values fall back to defaults. By default, `/tree` keeps Pi's native behavior and only changes the conversation position; it does not modify files.

Example: keep a shared `ayu.rewind` default in user settings, then override just one field in the project.

```json
// ~/.pi/agent/settings.json
{
  "ayu": {
    "rewind": {
      "restoreOnTree": "ask"
    }
  }
}
```

```json
// .pi/settings.json
{
  "ayu": {
    "rewind": {
      "restoreOnTree": "always"
    }
  }
}
```

Supported values:

| Setting    | Behavior                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `"never"`  | Default. Keep Pi-native `/tree` behavior; do not restore files.                                                           |
| `"ask"`    | Ask `Sync files?` only when the session has checkpointed file changes; `Yes` restores files, `No` leaves files unchanged. |
| `"always"` | Restore files when `/tree` navigates with `No summary`.                                                                   |

`/rewind` code restore, fork, clone, and resume behavior are not controlled by `ayu.rewind.restoreOnTree`.

Known limitation: when `restoreOnTree` is `"ask"`, pressing Esc in Pi's `Sync files?` dialog cancels the prompt after Pi has already left the tree selector. The built-in `/tree` selector has already called `done()` and closed before `pi-rewind` can show `Sync files?`, so an extension cannot return focus to the previous tree level without changing Pi's package implementation. `pi-rewind` documents this behavior instead of emulating tree navigation.

Legacy top-level `checkpoint` settings are still accepted for compatibility, but new setups should use `ayu.checkpoint`.

## Session deletion

Pi currently exposes session switch, resume, tree, fork, and clone hooks to extensions, but not a dedicated session deletion hook for `pi -r` / `/resume` `Ctrl+D` deletion. Because checkpoint storage deletion is irreversible, `pi-rewind` does not infer deleted sessions or automatically garbage-collect orphan checkpoint repositories.

If Pi adds a deletion lifecycle event such as `session_before_delete` or `session_deleted`, `pi-rewind` should use that exact hook to remove only the deleted session's matching checkpoint storage and clear related in-memory state. Until then, deleting a session may leave orphan checkpoint storage on disk, while `/rewind` metadata disappears with the deleted session JSONL.

## Development

```bash
pnpm run build    # tsdown bundle into dist/
pnpm run dev      # watch mode
pnpm test         # run tests
pnpm run coverage # coverage report
pnpm run typecheck# tsc --noEmit
```

## License

GPL-3.0
