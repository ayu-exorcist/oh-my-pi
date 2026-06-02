# @ayulab/pi-workflow

Pi extension providing the `/ayu` workflow command router.

## Features

- `/ayu` workflow prompts for task planning, diff review, docs sync, release checks, verification reports, and AI-engineering audits
- Prompts are sent immediately when Pi is idle or queued as follow-up while an agent is running
- Write Mode controls are intentionally owned by `@ayulab/pi-write-gate`

## Dependencies

- `@earendil-works/pi-coding-agent` — Pi Extension API

## Installation

As part of the curated collection:

```bash
pi install npm:@ayulab/oh-my-pi
```

Or standalone:

```bash
pi install npm:@ayulab/pi-workflow
```

For Write Mode and mutating tool protection, also install:

```bash
pi install npm:@ayulab/pi-write-gate
```

## Usage

The extension registers automatically after Pi starts.

### Workflow commands

```text
> /ayu task add a new command
# Sends the bundled task-planning prompt. No files are edited by the prompt itself.

> /ayu review docs
# Sends the bundled diff-review prompt focused on docs.
```

| Command                  | Behavior                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `/ayu help`              | Show help                                                       |
| `/ayu task <goal>`       | Plan a task before edits                                        |
| `/ayu review [focus]`    | Review current git diff                                         |
| `/ayu docs [scope]`      | Check documentation sync needs                                  |
| `/ayu release [scope]`   | Run release-readiness review without publishing/tagging/pushing |
| `/ayu verify [criteria]` | Produce a verification report                                   |
| `/ayu audit [scope]`     | Audit project AI-engineering workflow                           |

## Write Mode

Write Mode moved to `@ayulab/pi-write-gate` so it can evolve into a reusable safety gate independent of Ayu workflow prompts.

Use:

```text
/write-gate on
/write-gate off
/write-gate status
Alt+S
```

If users call old Write Mode commands through `/ayu`, this workflow extension reports a migration warning and points them to `/write-gate`.

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
