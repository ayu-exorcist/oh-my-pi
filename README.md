# @ayulab/oh-my-pi

> Personal [Pi](https://pi.dev) toolkit: extensions, skills, prompts, and themes.
>
> Published as a [Pi Package](https://pi.dev/docs/latest/packages). Install with `pi install`.

## One-line Install

### Curated Collection (Recommended)

Install `@ayulab/oh-my-pi` to get all curated extensions. Enable or disable individual extensions via `pi config` after installation:

```bash
pi install npm:@ayulab/oh-my-pi
```

The curated package enables the lightweight safety and clarification baseline by default, while optional workflow/rollback extensions stay disabled until you opt in. Use `pi config` to toggle interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control:

```json
{
  "packages": [
    {
      "source": "npm:@ayulab/oh-my-pi",
      "extensions": ["!node_modules/@ayulab/pi-undo-redo"]
    }
  ]
}
```

### Atomic Install (Pick What You Need)

Each extension is published independently. Install only what you need:

```bash
pi install npm:@ayulab/pi-clarify
pi install npm:@ayulab/pi-workflow
pi install npm:@ayulab/pi-rewind
pi install npm:@ayulab/pi-undo-redo
```

### Local Development

```bash
pi install /path/to/oh-my-pi
pi install ./relative/path/to/oh-my-pi
```

After installation, Pi automatically loads resources from convention directories:

| Directory     | Content                    |
| ------------- | -------------------------- |
| `extensions/` | Extensions (`.ts` / `.js`) |
| `skills/`     | Skills (`SKILL.md`)        |
| `prompts/`    | Prompt templates (`.md`)   |
| `themes/`     | Themes (`.json`)           |

Pi runs `npm install` automatically during installation to resolve `package.json` dependencies.

## Repository Structure

```
@ayulab/oh-my-pi/
├── extensions/           # Pi extensions (independently published)
│   ├── pi-clarify/       # @ayulab/pi-clarify — structured one-question clarification
│   ├── pi-compact/       # @ayulab/pi-compact — compact tool output summaries
│   ├── pi-workflow/      # @ayulab/pi-workflow — /ayu workflow prompt router
│   ├── pi-rewind/        # @ayulab/pi-rewind — /rewind interactive rollback
│   └── pi-undo-redo/     # @ayulab/pi-undo-redo — /undo /redo commands
├── sdk/                  # Shared infrastructure (independently published)
│   └── pi-checkpoint/    # @ayulab/pi-checkpoint — git checkpoint engine
├── skills/               # Skills
├── prompts/              # Prompt templates
├── themes/               # Themes
│   └── purple-dream.json # Purple Dream dark theme
├── scripts/
│   ├── publish.ts        # Publish + tag + release
│   ├── setup.ts          # Register repo in Pi settings
│   └── teardown.ts       # Unregister repo from Pi settings
├── package.json          # Pi Package manifest (curated meta package)
├── CHANGELOG.md          # Curated release log
├── .npmrc                # npm provenance config
├── LICENSE               # GPL-3.0
├── pnpm-workspace.yaml
└── vitest.config.ts
```

## What's Included

| Package                                           | Description                                          |
| ------------------------------------------------- | ---------------------------------------------------- |
| [`@ayulab/pi-checkpoint`](sdk/pi-checkpoint)      | Git bare-repo checkpoint engine. Zero deps.          |
| [`@ayulab/pi-clarify`](extensions/pi-clarify)     | Structured one-question clarification prompts.       |
| [`@ayulab/pi-compact`](extensions/pi-compact)     | Compact one-line summaries for built-in tool output. |
| [`@ayulab/pi-workflow`](extensions/pi-workflow)   | `/ayu` workflow prompt router and Plan Mode.         |
| [`@ayulab/pi-rewind`](extensions/pi-rewind)       | `/rewind` command — interactive checkpoint restore.  |
| [`@ayulab/pi-undo-redo`](extensions/pi-undo-redo) | `/undo` and `/redo` commands.                        |
| [`@ayulab/pi-trace-lab`](extensions/pi-trace-lab) | Trace collection, review, and harness iteration.     |
| [`claim-check`](skills/claim-check)               | Audit strong claims and source mapping.              |
| [`doc-audit`](skills/doc-audit)                   | Read-only doc structure and sync audit.              |
| [`Purple Dream`](themes/purple-dream.json)        | Dark purple theme for long coding sessions.          |

## Extension Management

After installation, `pi-clarify`, `pi-compact`, and `pi-mcp-adapter` are enabled by default. `pi-workflow`, `pi-rewind`, and `pi-undo-redo` are bundled but disabled by default. Toggle interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control.

## Permission & Safety

This package no longer bundles a custom write gate. Install `@gotgenes/pi-permission-system` separately for deterministic permission enforcement (allow/ask/deny) across tools, bash, MCP, and file paths.

```bash
pi install npm:@gotgenes/pi-permission-system
```

See the [permission-system docs](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) for configuration (`~/.pi/agent/extensions/pi-permission-system/config.json`).

## Using /ayu

```text
> /ayu plan refactor auth module
# Read-only research and structured planning. No file edits.

> /ayu task add validation tests
# Sends a planning prompt and does not edit files by itself.

> /ayu bug "token refresh fails after 401"
# Structured diagnosis: reproduce → test → fix → verify.

> /ayu review docs
# Sends a diff-review prompt focused on documentation.

> /ayu verify
# Summarizes verification evidence after implementation.

> /ayu journal
# Updates the session journal with decisions, blockers, and next steps.

> /ayu harness-iteration
# Draft a harness iteration card from a recent failure.

> /ayu benchmark [suite-path]
# Draft a benchmark run report for a harness change.
```

## Using /trace-lab

Trace Lab turns Pi sessions into measurable experiments. It collects tool sequences and file operations silently, detects anomalies in real time, and provides a structured workflow for turning failures into harness improvements.

```text
> /trace-lab status
Turns: 3 | Tool calls: 12 | Signals: none

> /trace-lab review
# Structured TUI review of the latest session

> /trace-lab weekly
# Cluster reviews into patterns

> /trace-lab draft <pattern-id>
# Generate harness iteration card

> /trace-lab benchmark [suite-path]
# Draft a benchmark run report

> /trace-lab sync
# Sync verified patterns to ai-engineering
```

## Using /journal

Update the session journal with a concise summary:

```text
> /ayu journal
# Summarizes the session into ~/.pi/agent/ayu/workspace/journal.md
```

## Using /rewind

After starting Pi, the Rewind extension registers automatically. Every prompt you send triggers a background checkpoint.

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
git clone https://github.com/ayu-exorcist/oh-my-pi.git
cd oh-my-pi
mise install && pnpm install
```

Build all workspace packages before publishing:

```bash
pnpm run build   # turborepo build with caching
pnpm run release # publish to npm
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full development guide — mise setup, scripts, quality gate, adding extensions, build config, and release workflow.

## License

GNU General Public License v3.0 (GPL-3.0)

See [LICENSE](./LICENSE) for the full text.
