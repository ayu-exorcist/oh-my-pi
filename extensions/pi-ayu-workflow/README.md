# @ayulab/pi-ayu-workflow

Pi extension providing the Ayu Write Gate and `/ayu` workflow command router.

## Features

- Write Mode toggle with `Alt+S`, `/ayu on`, `/ayu write on`, `/ayu off`, and `/ayu write off`
- Explicit Write Mode semantics in the system prompt: Off steers planning/review/read-only inspection; On steers small verified implementation
- Write Gate that blocks mutating tool calls while Write Mode is Off
- Read-only inspection escape hatch for narrow git commands (`status`, `diff`, `log`, `show`, `branch --show-current`)
- Editor label showing `Write Mode: On` or `Write Mode: Off`
- `/ayu` workflow prompts for task planning, diff review, docs sync, release checks, verification reports, and AI-engineering audits
- Task-boundary system prompt when Write Mode is On
- One-shot write authorization: `/ayu on <prompt>` auto-turns Write Mode Off after that agent run

## Dependencies

- `@earendil-works/pi-coding-agent` — Pi Extension API
- `@earendil-works/pi-tui` — editor label rendering

## Installation

As part of the curated collection:

```bash
pi install npm:@ayulab/oh-my-pi
```

Or standalone:

```bash
pi install npm:@ayulab/pi-ayu-workflow
```

## Usage

The extension registers automatically after Pi starts. Write Mode starts Off for each session.

```text
> /ayu status
Ayu Write Mode: Off

> /ayu task add a new command
# Sends the bundled task-planning prompt. No files are edited by the prompt itself.

> /ayu on implement the confirmed plan
# Turns Write Mode On, sends the prompt immediately, then auto-turns Off when the run ends.
```

Commands:

| Command                                       | Behavior                                        |
| --------------------------------------------- | ----------------------------------------------- |
| `/ayu help`                                   | Show help and current Write Mode                |
| `/ayu status`                                 | Show current Write Mode                         |
| `/ayu on` / `/ayu write on`                   | Enable Write Mode until manually disabled       |
| `/ayu on <prompt>` / `/ayu write on <prompt>` | Enable Write Mode for one prompt, then auto-Off |
| `/ayu off` / `/ayu write off`                 | Disable Write Mode                              |
| `/ayu task <goal>`                            | Plan a task before edits                        |
| `/ayu review [focus]`                         | Review current git diff                         |
| `/ayu docs [scope]`                           | Check documentation sync needs                  |
| `/ayu release [scope]`                        | Run release-readiness review without publishing |
| `/ayu verify [criteria]`                      | Produce a verification report                   |
| `/ayu audit [scope]`                          | Audit project AI-engineering workflow           |

Shortcut:

| Shortcut | Behavior                                  |
| -------- | ----------------------------------------- |
| `Alt+S`  | Toggle Write Mode for the current session |

## Write Gate

When Write Mode is Off, Ayu is not just a lock. It also injects an Off-mode prompt that steers the assistant toward discussion, planning, review, and read-only inspection. The Write Gate blocks mutating tool calls such as `write`, `edit`, mutating shell commands, nested mutating tools in `multi_tool_use.parallel`, and potentially mutating MCP calls.

When Write Mode is On, Ayu injects an On-mode prompt for small, verified implementation: current request only, relevant context first, no unrelated refactors or dependency churn, explicit verification evidence, and no commit/tag/push/publish/release unless explicitly requested.

Read-only commands remain available. Bash is allowed only for a narrow git inspection subset without shell metacharacters:

- `git status`
- `git diff`
- `git log`
- `git show`
- `git branch --show-current`

Ayu is a workflow guard, not a security sandbox. Extensions still run with the user's full system permissions.

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
