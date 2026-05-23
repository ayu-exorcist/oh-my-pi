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
│   ├── publish.ts        # Topological publish + auto CHANGELOG
│   ├── setup.ts          # Symlink sync for local development
│   └── teardown.ts       # Remove symlinks created by setup
├── package.json          # Pi Package manifest (curated meta package)
├── CHANGELOG.md          # Curated release log
├── LICENSE               # GPL-3.0
├── pnpm-workspace.yaml
└── vitest.config.ts
```

## Included Extensions

### @ayulab/pi-checkpoint

File-level checkpoint engine powered by git bare repos:

- Auto-create checkpoint on every user turn
- Metadata stored as Pi session custom entries
- Fork / clone / restore support
- Zero runtime dependencies; usable standalone

Key exports:

```typescript
export { loadConfig, loadConfigFromFile } from "@ayulab/pi-checkpoint";
export { RepoManager } from "@ayulab/pi-checkpoint";
export { getRepoDir, getGitDir, getIndexPath } from "@ayulab/pi-checkpoint";
export { exec, type ExecEnv } from "@ayulab/pi-checkpoint";
export { extractCheckpointData } from "@ayulab/pi-checkpoint";
export type { CheckpointConfig, FileChange } from "@ayulab/pi-checkpoint";
```

### @ayulab/pi-rewind

Pi extension providing the `/rewind` command:

- Interactive checkpoint list with file-change stats
- Four restore modes (code / conversation / both / summarize)
- File-change counters (`+n -m`)
- Auto-copy checkpoint repo on fork / clone

### @ayulab/pi-undoredo

Pi extension providing `/undo` and `/redo` commands:

- Checkpoint-based undo / redo
- Undo/redo at both conversation and code level

## Curated Release Strategy

`@ayulab/oh-my-pi` follows a **curated release** model:

- Sub-extensions iterate independently and are published to npm individually.
- `@ayulab/oh-my-pi` curates releases manually: the maintainer decides which sub-extension versions to include.
- All dependency versions are **pinned exactly** — every curated release is a reproducible snapshot.
- Curated releases auto-generate `CHANGELOG.md` listing all bundled dependency versions.
- Experimental features are published standalone for several releases; only stable features are considered for curation.

Publish workflow (handled by `scripts/publish.ts`):

```bash
# Publish all changed sub-packages (topological order)
pnpm run release

# Dry-run preview
pnpm run release:dry
```

## Extension Management

After installing the curated collection, all extensions are enabled by default. Control them via:

```bash
# Interactive toggle for extensions, skills, and themes
pi config

# Or filter precisely in settings.json
{
  "packages": [
    {
      "source": "npm:@ayulab/oh-my-pi",
      "extensions": ["!node_modules/@ayulab/pi-undoredo/index.ts"]
    }
  ]
}
```

## Included Themes

### Purple Dream

Dark purple theme with soft contrast, ideal for long coding sessions.

- Background: `#15101e`
- Accents: `#c084fc` / `#e879f9`
- Syntax: purple keywords, green strings, orange numbers

Select **Purple Dream** in Pi settings to activate.

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

### Clone

```bash
git clone https://github.com/your-org/ayu-pi.git ~/ayu-pi
cd ~/ayu-pi
pnpm install
```

### Sync to Pi (Local Dev)

```bash
# Symlink to ~/.pi/agent/ (global, default)
pnpm run setup

# Symlink to ./.pi/ (project-local)
pnpm run setup:local
```

Source changes take effect immediately in Pi (extensions support `/reload` hot-reload).

### Remove Local Symlinks

```bash
# Remove global symlinks
pnpm run teardown

# Remove local symlinks
pnpm run teardown:local
```

### Scripts

```bash
# Watch mode
pnpm run dev

# Single test run
pnpm test

# Coverage (100% threshold enforced)
pnpm run coverage

# Coverage + open in browser
pnpm run coverage:open

# Type check
pnpm run typecheck

# Lint (oxlint)
pnpm run lint
pnpm run lint:fix

# Format (oxfmt)
pnpm run fmt
pnpm run fmt:check

# Local full check (type + lint + fmt + test)
pnpm run check

# CI gate (type + lint + fmt + coverage)
pnpm run ci
```

### Git Hooks

[simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) runs the full CI gate before every commit:

```
pre-commit → pnpm run ci
```

This executes `tsc --noEmit && oxlint . && oxfmt . --check && vitest run --coverage` (100% threshold).

Skip hooks (not recommended): `git commit -m "xxx" --no-verify`

## Adding New Content

### Add an Extension

Create a new directory under `extensions/`:

```
extensions/
└── my-ext/
    ├── index.ts          # Pi extension entry (exports default function)
    ├── package.json      # Extension package config
    ├── vitest.config.ts  # Optional
    └── src/
        ├── index.ts      # Extension logic
        └── ...           # Source + tests
```

Entry `index.ts` example:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("My extension loaded!", "info");
  });
}
```

If the extension depends on `@ayulab/pi-checkpoint`, declare it in `package.json`:

```json
{
  "dependencies": {
    "@ayulab/pi-checkpoint": "workspace:*"
  }
}
```

### Add a Theme

Drop a `.json` theme file into `themes/`:

```
themes/
└── my-theme.json
```

Pi loads all `.json` files from the `pi.themes` directories configured in `package.json`.

### Add Skills / Prompts

```
skills/
└── my-skill/
    └── SKILL.md

prompts/
└── my-prompt/
    └── prompt.md
```

No `package.json` needed — Pi reads the content files directly.

## Publishing to Pi Gallery

This repository is configured as a [Pi Package](https://pi.dev/docs/latest/packages):

- `keywords` includes `pi-package` — gallery inclusion
- `pi.extensions` — extension paths
- `pi.themes` — theme paths
- Convention directories `skills/` and `prompts/` — auto-discovered

Publish to npm:

```bash
# Log in to npm
npm login

# Publish SDK
pnpm publish --filter @ayulab/pi-checkpoint

# Publish extension
pnpm publish --filter @ayulab/pi-rewind
```

Gallery inclusion requires `pi-package` in `keywords` — already configured.

## License

GNU General Public License v3.0 (GPL-3.0)

See [LICENSE](./LICENSE) for the full text.
