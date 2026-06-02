# @ayulab/pi-write-gate

Pi extension providing user-controlled Write Mode authorization and mutating tool protection.

## Features

- Write Mode toggle with `Alt+S`, `/write-gate on`, `/write-gate off`, `/write-gate write on`, and `/write-gate write off`.
- Explicit write authorization semantics injected into the system prompt:
  - Off steers discussion, planning, review, and read-only inspection.
  - On permits small verified local implementation until the user turns it Off.
- Write Gate blocks mutating tool calls while Write Mode is Off.
- Read-only inspection escape hatch for narrow git commands (`status`, `diff`, `log`, `show`, `branch --show-current`).
- Editor label showing `Write Mode: On` or `Write Mode: Off`.
- Session persistence for user-set Write Mode on startup/resume/reload.

## Non-goals

Write Gate is not a Claude/Copilot-style Plan Mode or Agent Mode. It does not decide when the agent should plan or implement. It only enforces whether the user has authorized persistent local writes.

Write Gate does not auto-send prompts and does not auto-turn Write Mode Off after a run. The user owns the Write Mode state.

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
pi install npm:@ayulab/pi-write-gate
```

## Usage

New sessions and forked sessions start with Write Mode Off. Resumed/reloaded sessions restore the last Write Mode explicitly set by the user in that session.

```text
> /write-gate status
Write Mode: Off

> /write-gate on
# Turns Write Mode On. Send the implementation request as the next message.

> /write-gate off
# Turns Write Mode Off.
```

Commands:

| Command                                     | Behavior                                 |
| ------------------------------------------- | ---------------------------------------- |
| `/write-gate help`                          | Show help and current Write Mode         |
| `/write-gate status`                        | Show current session Write Mode          |
| `/write-gate on` / `/write-gate write on`   | Enable Write Mode until user disables it |
| `/write-gate off` / `/write-gate write off` | Disable Write Mode                       |

Shortcut:

| Shortcut | Behavior                                  |
| -------- | ----------------------------------------- |
| `Alt+S`  | Toggle Write Mode for the current session |

## State behavior

| Session event             | Write Mode behavior          |
| ------------------------- | ---------------------------- |
| New session               | Off                          |
| Forked session            | Off                          |
| Resume / continue session | Restore last persisted state |
| Reload current session    | Restore last persisted state |
| Agent turn ends           | No automatic change          |

If a trailing prompt is supplied after `/write-gate on`, Write Gate ignores it and asks the user to send it as the next message. This keeps write authorization separate from task instructions.

## Write Gate

When Write Mode is Off, Write Gate injects an Off-mode prompt that steers the assistant toward discussion, planning, review, and read-only inspection. The Write Gate blocks mutating tool calls such as `write`, `edit`, mutating shell commands, nested mutating tools in `multi_tool_use.parallel`, and potentially mutating MCP calls.

When Write Mode is On, Write Gate injects an On-mode prompt for small, verified implementation: current request only, relevant context first, no unrelated refactors or dependency churn, explicit verification evidence, and no commit/tag/push/publish/release unless explicitly requested.

Read-only commands remain available. Bash is allowed only for a narrow git inspection subset without shell metacharacters:

- `git status`
- `git diff`
- `git log`
- `git show`
- `git branch --show-current`

Write Gate is a workflow guard, not a security sandbox. Extensions still run with the user's full system permissions.

## Relationship to @ayulab/pi-workflow

`@ayulab/pi-write-gate` owns Write Mode, system prompt injection, editor status, and mutating tool blocking.

`@ayulab/pi-workflow` owns `/ayu` workflow prompts such as task planning, review, docs sync, release checks, verification reports, and AI-engineering audits. It reports migration guidance if users call old Write Mode commands through `/ayu`.

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
