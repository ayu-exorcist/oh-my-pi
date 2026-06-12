# @ayulab/pi-clarify

Pi extension providing structured one-question clarification prompts for agents.

## Features

- `ask_user` tool for natural agent clarification.
- One prompt per tool call by design — no batch question walls.
- Supports:
  - `select` with optional custom text answer;
  - `multiselect` answered with numbers separated by spaces or commas, or `all`;
  - `text` single-line input;
  - `confirm` yes/no confirmation.
- `/clarify status` and `/clarify demo` management commands.
- Structured tool results and small session metadata entries.
- Refuses secret-like prompts and options.

## Why one question at a time?

CLI conversations are vertical. Large blocks of questions are hard to answer and easy to misread. `@ayulab/pi-clarify` intentionally accepts exactly one prompt per tool call so the agent must clarify serially:

1. ask one answerable question;
2. wait for the user's answer;
3. continue or ask the next question if it still matters.

## Secret Safety

This package intentionally does **not** implement password prompts.

Secrets should not pass through model-mediated workflows. Do not ask users for passwords, API keys, tokens, cookies, private keys, or credentials. Use environment variables, OS keychains, OAuth, or dedicated secret managers instead.

## Installation

As part of the curated collection:

```bash
pi install npm:@ayulab/oh-my-pi
```

Or standalone:

```bash
pi install npm:@ayulab/pi-clarify
```

## Usage

The extension registers an `ask_user` tool for the agent and a `/clarify` command for status/demo.

```text
> /clarify status
Pi Clarify: enabled
Supported prompt types: select, multiselect, text, confirm

> /clarify demo
# Opens an interactive select prompt.
```

Agents should use `ask_user` when a missing decision would materially affect files, scope, public API, package metadata, safety posture, or release behavior.

### Tool behavior

Questions are rendered in the conversation stream with a clack-style prompt (`◇` / `│`). The user replies directly in the input box — no modal popup.

`select` — reply with the option number. If `allowCustom` is true, any non-number reply is treated as a custom answer.

`multiselect` — reply with numbers separated by spaces or commas (e.g. `1 2 3`), or `all` to select everything.

`text` — reply with a single-line free-form answer.

`confirm` — reply with `y`/`yes` or `n`/`no`.

Send an empty message to cancel in all modes. The tool returns a structured cancellation result instead of guessing.

## Out of Scope

- Batch questions.
- Password prompts.
- Full `@clack/prompts` compatibility (we use Pi's native TUI to emulate the visual style).
- Intercepting or rewriting normal assistant Markdown output.

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
