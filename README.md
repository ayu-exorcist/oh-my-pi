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

The curated package enables `pi-rewind` by default. `pi-brief` and `pi-clarify` are still in development and are not bundled or published yet. Use `pi config` to toggle bundled extensions interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control:

```json
{
  "packages": [
    {
      "source": "npm:@ayulab/oh-my-pi",
      "extensions": ["!node_modules/@ayulab/pi-rewind"]
    }
  ]
}
```

### Atomic Install (Pick What You Need)

Published extensions can also be installed independently:

```bash
pi install npm:@ayulab/pi-rewind
```

`@ayulab/pi-brief` and `@ayulab/pi-clarify` are private while they are still in development.

### Local Development

```bash
pi install /path/to/oh-my-pi
pi install ./relative/path/to/oh-my-pi
```

After installation, Pi loads bundled extension packages from the package manifest, and automatically loads resources from these convention directories when present:

| Directory  | Content                  |
| ---------- | ------------------------ |
| `skills/`  | Skills (`SKILL.md`)      |
| `prompts/` | Prompt templates (`.md`) |
| `themes/`  | Themes (`.json`)         |

Pi runs `npm install` automatically during installation to resolve `package.json` dependencies.

## Repository Structure

```
@ayulab/oh-my-pi/
├── extensions/           # Pi extensions
│   ├── pi-clarify/       # @ayulab/pi-clarify — private, in development
│   ├── pi-brief/         # @ayulab/pi-brief — private, in development
│   └── pi-rewind/        # @ayulab/pi-rewind — /rewind interactive rollback
├── sdk/                  # Publishable SDK packages
│   └── pi-checkpoint/    # @ayulab/pi-checkpoint — git checkpoint engine
├── internal/             # Private workspace packages, not published
│   ├── runtime-core/     # @ayulab/runtime-core — bundled runtime helpers
│   └── repo-tools/       # @ayulab/repo-tools — build/test/release helpers
├── skills/               # Skills
├── prompts/              # Prompt templates
├── themes/               # Themes
│   └── purple-dream.json # Purple Dream dark theme
├── scripts/
│   ├── dist-manifest.ts  # Compatibility wrapper for pi-dist-manifest
│   ├── publish.ts        # Publish + tag + release
│   ├── setup.ts          # Register repo in Pi settings
│   └── teardown.ts       # Unregister repo from Pi settings
├── package.json          # Pi Package manifest (curated meta package)
├── .npmrc                # npm provenance config
├── LICENSE               # GPL-3.0
├── pnpm-workspace.yaml
└── vitest.config.ts
```

## What's Included

| Package                                      | Description                                         |
| -------------------------------------------- | --------------------------------------------------- |
| [`@ayulab/pi-checkpoint`](sdk/pi-checkpoint) | Git bare-repo checkpoint engine. Zero deps.         |
| [`@ayulab/pi-rewind`](extensions/pi-rewind)  | `/rewind` command — interactive checkpoint restore. |
| [`Purple Dream`](themes/purple-dream.json)   | Dark purple theme for long coding sessions.         |

## Extension Management

After installation, `pi-rewind` is enabled by default. Toggle interactively:

```bash
pi config
```

Or use [Package Filtering](https://pi.dev/docs/latest/packages#package-filtering) in `settings.json` for fine-grained control.

## Using /rewind

After starting Pi, the Rewind extension registers automatically and captures a checkpoint for every prompt.

Use `/rewind` to return to any earlier turn and choose the restore scope that matches what you want to do:

- **Restore code and conversation** — roll the workspace and the conversation back together
- **Restore conversation** — revisit an earlier idea without touching files
- **Restore code** — bring files back while keeping the current conversation position

It shines when you want to:

- retry a prompt after fixing the code it produced
- inspect an earlier branch of thought without changing the workspace
- restore files from a checkpoint and keep working on the same conversation path
- use `/tree` for navigation and choose whether file state should sync after Pi's native `No summary` choice

Pi-native `/tree` behavior is preserved by default; set `ayu.rewind.restoreOnTree` to `"ask"` or `"always"` if you want `/tree` to offer or perform file sync.

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

Select mode: 1
✓ Rewind completed
```

## Development

```bash
git clone https://github.com/ayu-exorcist/oh-my-pi.git
cd oh-my-pi
mise install && pnpm install
```

Publish current unpublished package versions:

```bash
pnpm run release # build, validate, publish via Changesets, and create tags
```

See `CONTRIBUTING.md` for the full development guide — mise setup, scripts, quality gate, adding extensions, build config, and release workflow.

## License

GNU General Public License v3.0 (GPL-3.0)

See [LICENSE](./LICENSE) for the full text.
