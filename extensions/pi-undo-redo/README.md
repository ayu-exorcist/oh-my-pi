# @ayulab/pi-undo-redo

Pi extension providing `/undo` and `/redo` interactive commands, built on the checkpoint engine for conversation- and code-level undo/redo.

## Features

- `/undo` — revert the last agent turn and restore both code and conversation state
- `/redo` — replay a previously undone turn
- Detects unsnapshotted workspace changes and warns before proceeding
- Safe rollback: automatically restores to a safety point if checkout fails
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
pi install npm:@ayulab/pi-undo-redo
```

## Usage

The extension registers automatically after Pi starts. It consumes checkpoint entries written by any checkpoint-aware extension (e.g. `@ayulab/pi-rewind`). If no such extension is active, `/undo` and `/redo` will report that nothing is available.

```
> /undo
Undo complete. Workspace restored to before that turn.

> /redo
Redo complete. Workspace restored.
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
