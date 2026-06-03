# @ayulab/pi-workflow

Pi extension providing the `/ayu` workflow command router.

## Features

- `/ayu` workflow prompts for task planning, diff review, docs sync, release checks, verification reports, and AI-engineering audits
- Prompts are sent immediately when Pi is idle or queued as follow-up while an agent is running
- Permission enforcement is intentionally left to a user-installed permission system

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
| `/ayu goal <objective>`  | Persist until the goal is complete and verified                 |
| `/ayu task <goal>`       | Plan a task before edits                                        |
| `/ayu plan <goal>`       | Research read-only and produce a structured proposed plan       |
| `/ayu bug <description>` | Diagnose with reproduce→test→fix→verify                         |
| `/ayu review [focus]`    | Review current git diff                                         |
| `/ayu docs [scope]`      | Check documentation sync needs                                  |
| `/ayu release [scope]`   | Run release-readiness review without publishing/tagging/pushing |
| `/ayu verify [criteria]` | Produce a verification report                                   |
| `/ayu audit [scope]`     | Audit project AI-engineering workflow                           |
| `/ayu journal`           | Update session journal                                          |
| `/ayu harness-iteration` | Draft a harness iteration card                                  |
| `/ayu benchmark [suite]` | Run benchmark evaluation and produce a report                   |

## Permission Enforcement

This extension only sends workflow prompts. It does not own Write Mode, tool gating, or filesystem permission checks.
Install and configure a permission system separately when deterministic allow/ask/deny enforcement is required.

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
