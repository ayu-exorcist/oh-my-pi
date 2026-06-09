# @ayulab/pi-brief

Pi extension that briefs built-in tool output to one-line summaries, keeping sessions focused on decisions.

## Why?

Pi agents often run many `read`, `grep`, `find`, and `bash` calls while exploring a codebase. Most of that output is intermediate context the user never needs to read. `@ayulab/pi-brief` collapses every built-in tool result to a single summary line so you can focus on what matters — especially when paired with `@ayulab/pi-clarify` for structured decision prompts.

## Features

- One-line summaries for `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`
- `Ctrl+O` expands any result to see full output
- `/brief on | off | status` toggle
- Session-persistent state

## Installation

As part of the curated collection:

```bash
pi install npm:@ayulab/oh-my-pi
```

Or standalone:

```bash
pi install npm:@ayulab/pi-brief
```

## Usage

```text
> /brief status
Brief mode: on

> /brief off
Brief mode: off
```

When brief mode is on, tool results look like:

```text
read src/index.ts → 45 lines
bash npm test → 12 lines
grep /foo/ in src → 3 matches
edit src/auth.ts → edited +2 -1
```

Press `Ctrl+O` to expand any result.

## Out of Scope

- MCP tools, `web_search`, `fetch_content`, `code_search`
- Filtering or rewriting assistant text messages
- Affecting `ask_user` or other extension UIs

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
