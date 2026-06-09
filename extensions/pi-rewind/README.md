# @ayulab/pi-rewind

Pi extension providing the `/rewind` interactive checkpoint navigation command.

## Features

- Interactive checkpoint list with file-change statistics
- Rewind restores a selected prompt to its pre-run code state (`beforeCommit`), so the turn can be run again
- Restore options for checkpoints with file changes:
  1. Restore code and conversation
  2. Restore conversation
  3. Restore code
  4. Restore conversation with summary
  5. Restore conversation with custom summary
- Conversation-only restore options when the checkpoint list has no file changes
- Optional file-state sync when navigating the Pi session tree (`ayu.rewind.restoreOnTree: "always"`)
- Auto-copy checkpoint repo on fork / clone; clone restores code to the selected checkpoint's `afterCommit` by default
- Real-time file-change counter for the current turn
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

The extension registers automatically after Pi starts, and quietly captures a checkpoint for every prompt.

Use `/rewind` to jump back to any earlier turn and choose the exact restore scope you want:

- **Restore code and conversation** — roll both the workspace and the conversation back to the selected checkpoint
- **Restore conversation** — revisit an earlier idea without touching files
- **Restore code** — bring files back while keeping the current conversation position
- **Restore conversation with summary** — move the conversation back with Pi's default summary flow
- **Restore conversation with custom summary** — move the conversation back with custom summary focus instructions

It fits the moments when you want to:

- retry a prompt after fixing the code it generated
- inspect an earlier branch of thought without changing the workspace
- restore files from a checkpoint while staying on the current conversation path
- use `/tree` for navigation and only restore files when `ayu.rewind.restoreOnTree` is enabled

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
[4] Restore conversation with summary
[5] Restore conversation with custom summary

Select mode: 1
✓ Rewind completed
```

## Configuration

By default, `/tree` keeps Pi's native behavior and only changes the conversation position; it does not modify files. To make `/tree` also restore files to the selected record's checkpoint state, opt in with `ayu.rewind.restoreOnTree`:

```json
{
  "ayu": {
    "rewind": {
      "restoreOnTree": "always"
    }
  }
}
```

Supported values:

| Setting    | Behavior                                                        |
| ---------- | --------------------------------------------------------------- |
| `"never"`  | Default. Keep Pi-native `/tree` behavior; do not restore files. |
| `"always"` | Restore files when `/tree` navigates to a session record.       |

`/rewind` code restore, fork, clone, and resume behavior are not controlled by `ayu.rewind.restoreOnTree`.

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
