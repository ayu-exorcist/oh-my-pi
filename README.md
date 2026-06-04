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

| Package                                                           | Description                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| [`@ayulab/pi-checkpoint`](sdk/pi-checkpoint)                      | Git bare-repo checkpoint engine. Zero deps.               |
| [`@ayulab/pi-clarify`](extensions/pi-clarify)                     | Structured one-question clarification prompts.            |
| [`@ayulab/pi-compact`](extensions/pi-compact)                     | Compact one-line summaries for built-in tool output.      |
| [`@ayulab/pi-permission-system`](extensions/pi-permission-system) | Permission gates for tools, bash, MCP, skills, and paths. |
| [`@ayulab/pi-workflow`](extensions/pi-workflow)                   | `/ayu` workflow prompt router and Plan Mode.              |
| [`@ayulab/pi-rewind`](extensions/pi-rewind)                       | `/rewind` command — interactive checkpoint restore.       |
| [`@ayulab/pi-undo-redo`](extensions/pi-undo-redo)                 | `/undo` and `/redo` commands.                             |
| [`@ayulab/pi-trace-lab`](extensions/pi-trace-lab)                 | Trace collection, review, and harness iteration.          |
| [`claim-check`](skills/claim-check)                               | Audit strong claims and source mapping.                   |
| [`doc-audit`](skills/doc-audit)                                   | Read-only doc structure and sync audit.                   |
| [`Purple Dream`](themes/purple-dream.json)                        | Dark purple theme for long coding sessions.               |

## Extension Management

After installation, `pi-permission-system`, `pi-clarify`, `pi-compact`, and `pi-mcp-adapter` are enabled by default. `pi-workflow`, `pi-rewind`, and `pi-undo-redo` are bundled but disabled by default. Toggle interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control.

## Permission & Safety

This package bundles `@ayulab/pi-permission-system`, a local workspace fork of `@gotgenes/pi-permission-system@7.4.1` adapted for Ayu paths. No separate npm install is required.

- local package: `extensions/pi-permission-system`
- bundled extension entry: `node_modules/@ayulab/pi-permission-system`
- global config: `~/.pi/agent/ayu/extensions/pi-permission-system/config.json`
- project config: `<cwd>/.pi/ayu/extensions/pi-permission-system/config.json`
- project template in this repo: `.pi/ayu/extensions/pi-permission-system/config.example.json`

Copy the project template to `config.json` if you want a repo-local baseline policy. See `extensions/pi-permission-system/README.md` for the full policy format and path rules.

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

After starting Pi, the Rewind extension registers automatically. Every prompt you send triggers a background checkpoint. Selecting a checkpoint rewinds code to the state before that prompt ran, so the selected turn can be run again. Pi-native `/tree` behavior is preserved by default; set `ayu.rewind.restoreOnTree` to `"always"` if you want `/tree` to restore files too.

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
