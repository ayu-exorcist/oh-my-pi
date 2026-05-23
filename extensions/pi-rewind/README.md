# @ayulab/pi-rewind

Pi extension providing the `/rewind` interactive checkpoint navigation command.

## Features

- Interactive checkpoint list with file-change statistics
- Five interactive options:
  1. Restore code and conversation
  2. Restore conversation only
  3. Restore code only
  4. Generate summary from selected point
  5. Never mind
- Auto-copy checkpoint repo on fork / clone
- Real-time file-change counter for the current turn

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

The extension registers automatically after Pi starts. A checkpoint is created in the background every time you send a prompt.

```
> /rewind

Recent checkpoints:
[1] refactor auth        10:23
   src/auth.ts +5 -2
   src/utils.ts +1 -0

[2] add tests            10:25
   src/auth.test.ts +1 -0

Select checkpoint: 2
Restore mode:
[1] Restore code and conversation
[2] Restore conversation only
[3] Restore code
[4] Summarize from here
[5] Never mind

Select mode: 1
✓ Rewind completed
```

## Development

```bash
pnpm run dev      # watch mode
pnpm test         # run tests
pnpm run coverage # coverage report
pnpm run typecheck# tsc --noEmit
```

## License

GPL-3.0
