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

All curated extensions are enabled by default. Use `pi config` to toggle interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control:

```json
{
  "packages": [
    {
      "source": "npm:@ayulab/oh-my-pi",
      "extensions": ["!node_modules/@ayulab/pi-undoredo/index.ts"]
    }
  ]
}
```

### Atomic Install (Pick What You Need)

Each extension is published independently. Install only what you need:

```bash
pi install npm:@ayulab/pi-rewind
pi install npm:@ayulab/pi-undoredo
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
│   ├── pi-rewind/        # @ayulab/pi-rewind — /rewind interactive rollback
│   └── pi-undoredo/      # @ayulab/pi-undoredo — /undo /redo commands
├── sdk/                  # Shared infrastructure (independently published)
│   └── pi-checkpoint/    # @ayulab/pi-checkpoint — git checkpoint engine
├── skills/               # Skills
├── prompts/              # Prompt templates
├── themes/               # Themes
│   └── purple-dream.json # Purple Dream dark theme
├── scripts/
│   ├── build.ts          # Topological build all workspace packages into dist/
│   ├── publish.ts        # Topological publish + tag + release
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

| Package                                         | Description                                         |
| ----------------------------------------------- | --------------------------------------------------- |
| [`@ayulab/pi-checkpoint`](sdk/pi-checkpoint)    | Git bare-repo checkpoint engine. Zero deps.         |
| [`@ayulab/pi-rewind`](extensions/pi-rewind)     | `/rewind` command — interactive checkpoint restore. |
| [`@ayulab/pi-undoredo`](extensions/pi-undoredo) | `/undo` and `/redo` commands.                       |
| [`Purple Dream`](themes/purple-dream.json)      | Dark purple theme for long coding sessions.         |

## Extension Management

After installation, all extensions are enabled by default. Toggle interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control.

## Using /rewind

After starting Pi, the extension registers automatically. Every prompt you send triggers a background checkpoint.

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
pnpm run build   # topological build via tsdown
pnpm run release # publish to npm
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full development guide — mise setup, scripts, quality gate, adding extensions, build config, and release workflow.

## License

GNU General Public License v3.0 (GPL-3.0)

See [LICENSE](./LICENSE) for the full text.
