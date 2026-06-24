# @ayulab/oh-my-pi

> Personal [Pi](https://pi.dev) reliability toolkit with rewind, checkpoints, and themes.
>
> Published as a [Pi Package](https://pi.dev/docs/latest/packages). Install with `pi install`.

## One-line Install

### Curated Collection (Recommended)

Install `@ayulab/oh-my-pi` to get all curated extensions. Enable or disable individual extensions via `pi config` after installation:

```bash
pi install npm:@ayulab/oh-my-pi
```

The curated package enables `pi-rewind` by default. Use `pi config` to toggle bundled extensions interactively:

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

### Local Development

For a checkout that you want to install or uninstall by path, prepare the workspace first:

```bash
pnpm install
pnpm run build
```

Then you can use the Pi package manager against the local path:

```bash
pi install /path/to/oh-my-pi
pi install ./relative/path/to/oh-my-pi
pi uninstall /path/to/oh-my-pi
pi uninstall ./relative/path/to/oh-my-pi
```

If you want Pi to discover the checkout without reinstalling it as a package, use the repository scripts instead:

```bash
pnpm run setup
pnpm run teardown
```

`pnpm run setup` adds the repository root to `~/.pi/agent/settings.json`, and `pnpm run teardown` removes it again. These scripts are useful for active development when you want local extensions and package resources to be visible to Pi without repeated package installs.

After installation, Pi loads bundled extension packages from the package manifest, and automatically loads resources from declared convention directories when present. The current repository ships one theme; the root manifest also reserves the standard `skills/` and `prompts/` paths for future packaged resources.

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
│   └── pi-rewind/        # @ayulab/pi-rewind — /rewind interactive rollback
├── sdk/                  # Publishable SDK packages
│   └── pi-checkpoint/    # @ayulab/pi-checkpoint — git checkpoint engine
├── internal/             # Private workspace packages, not published
│   ├── runtime-core/     # @ayulab/runtime-core — bundled runtime helpers
│   └── repo-tools/       # @ayulab/repo-tools — build/test/release helpers
├── themes/               # Themes
│   └── purple-dream.json # Purple Dream dark theme
├── scripts/
│   ├── dist-manifest.ts      # Compatibility wrapper for pi-dist-manifest
│   ├── pre-commit.ts         # Local hook orchestration
│   ├── publish-packages.ts   # Publish packages via Changesets
│   ├── release.ts            # Release orchestration entry point
│   ├── sync-release-tags.ts  # Push newly created release tags
│   ├── setup.ts              # Register repo in Pi settings
│   ├── teardown.ts           # Unregister repo from Pi settings
│   └── vitest.config.ts      # Script test config
├── package.json          # Pi Package manifest (curated meta package)
├── .npmrc                # npm provenance config
├── LICENSE               # GPL-3.0
├── pnpm-workspace.yaml
└── vitest.config.ts
```

## What's Included

| Package                                      | Description                                                   |
| -------------------------------------------- | ------------------------------------------------------------- |
| [`@ayulab/pi-checkpoint`](sdk/pi-checkpoint) | Git bare-repo checkpoint engine with bundled runtime helpers. |
| [`@ayulab/pi-rewind`](extensions/pi-rewind)  | `/rewind` command — interactive checkpoint restore.           |
| [`Purple Dream`](themes/purple-dream.json)   | Dark purple theme for long coding sessions.                   |

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

Pi-native `/tree` conversation navigation is preserved, and `ayu.rewind.restoreOnTree` now defaults to `"ask"`: after a no-summary `/tree` jump, Pi asks before syncing files when the session has checkpointed file changes. Set it to `"never"` to disable that prompt, or `"always"` to restore files automatically. Opening an existing session defaults to conversation-only (`ayu.checkpoint.restoreOnResume: false`); when enabled, `/resume` and startup selection such as `pi -r` force restore checkpoint-managed files to that session's latest checkpoint. For existing-session and `/tree` restore flows, missing checkpoint storage is shown as a warning-colored message above the editor input and clears on the next user input; whole-session storage loss is reported when entering an existing session with checkpointed file changes, while a missing selected checkpoint is reported when that restore is attempted. `/rewind` reports missing restore storage through its command UI notification so conversation-only restore can still proceed. `ayu` settings are merged recursively across user and project scopes, so `ayu.checkpoint` and `ayu.rewind` can be split across `~/.pi/agent/settings.json` and `.pi/settings.json`.

Use `/checkpoint` to inspect checkpoint storage state. `Current Folder` shows current-directory sessions that still have checkpoint storage plus manifested `[no session]` orphan storage for that directory. `All` adds live sessions from every directory; sessions without checkpoint storage appear as `[no checkpoints]`. Press `Ctrl+P` to toggle the right-side path display, and use `Ctrl+D` on a non-current storage row to confirm deletion. Deletion protects the current Pi instance's active session storage, but it does not detect another Pi instance using the same storage.

Phase 1 keeps the nested-repository safety boundary: if you start Pi from a broad workspace, nested Git repositories are excluded from the outer checkpoint. To protect a nested repository, start Pi in that repository root.

```
> /rewind

Recent checkpoints:
[1] add tests
   src/auth.test.ts +1 -0

[2] refactor auth
   2 files changed  +6 -2

[3] (current)

Select checkpoint: 1

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

Release PRs are created automatically from `main`, accumulate pending changesets until you are ready, and publish when the `changeset-release/main` PR is merged. Use `pnpm run release:dry` for local release-readiness checks.

See `CONTRIBUTING.md` for the full development guide — mise setup, scripts, quality gate, adding extensions, build config, and release workflow.

## License

GNU General Public License v3.0 (GPL-3.0)

See [LICENSE](./LICENSE) for the full text.
