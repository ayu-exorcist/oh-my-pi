# scripts/

Development and release automation for the `@ayulab/oh-my-pi` monorepo.

All scripts are TypeScript files executed via [`oxnode`](https://github.com/oxc-project/oxc-node) (zero-config TypeScript runner) and are registered as `package.json` scripts.

## Scripts

### `publish.ts` — Topological Publish

`pnpm run release` / `pnpm run release --dry-run`

Orchestrates npm publishing across the monorepo:

1. Scans `extensions/` and `sdk/` for publishable packages.
2. Compares local versions against the npm registry.
3. Builds a dependency graph from `package.json` `dependencies`.
4. Topologically sorts packages so dependencies are published before dependents.
5. Runs `pnpm publish` for each out-of-date package.
6. After the root package is published, auto-generates a `CHANGELOG.md` entry listing every bundled dependency and its exact version.

Flags:

| Flag                            | Short | Description                                          |
| ------------------------------- | ----- | ---------------------------------------------------- |
| `--dry-run`                     | —     | Preview what would be published without touching npm |
| `--all`                         | `-a`  | Publish all out-of-date packages                     |
| `--package=<name>`              | `-p`  | Publish a specific package (and its deps)            |
| `--access=<public\|restricted>` | —     | npm access level (default: `public`)                 |
| `--otp <code>`                  | —     | One-time password for two-factor authentication      |

`-p` and `-a` are mutually exclusive. If both are provided, `-p` wins.

Examples:

```bash
# Publish all out-of-date packages (default when no target is given)
pnpm run release

# Same as above, explicit
pnpm run release --all

# Publish a specific package (including its unpublished deps)
pnpm run release -p @ayulab/oh-my-pi

# Publish with OTP
pnpm run release --otp 123456

# Dry-run preview
pnpm run release --dry-run
```

### `setup.ts` — Symlink Sync (Development)

`pnpm run setup` / `pnpm run setup:local`

Creates symbolic links from this repository into the Pi agent directory so that local source changes are reflected immediately without re-installing.

Modes:

| Mode             | Target         | Command                |
| ---------------- | -------------- | ---------------------- |
| Global (default) | `~/.pi/agent/` | `pnpm run setup`       |
| Local            | `./.pi/`       | `pnpm run setup:local` |

What gets linked:

- `extensions/` → `extensions/`
- `skills/` → `skills/`
- `prompts/` → `prompts/`
- `themes/` → `themes/`
- `bundledDependencies` from `node_modules/` → matched category directories (`extensions/`, `skills/`, `prompts/`, `themes/`)

Before making any changes, the script displays a full plan and highlights conflicts (e.g., globally installed packages with the same name). You must confirm with `y` before proceeding.

### `teardown.ts` — Remove Symlinks

`pnpm run teardown` / `pnpm run teardown:local`

Reverses `setup.ts` by removing all symlinks that point back into this repository.

Modes:

| Mode             | Target         | Command                   |
| ---------------- | -------------- | ------------------------- |
| Global (default) | `~/.pi/agent/` | `pnpm run teardown`       |
| Local            | `./.pi/`       | `pnpm run teardown:local` |

The script skips items that are not managed by this project (e.g., globally installed pi-packages) and asks for confirmation before removing anything.
