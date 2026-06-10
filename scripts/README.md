# scripts/

Development and release automation for the `@ayulab/oh-my-pi` monorepo.

All top-level scripts are TypeScript files executed via [`oxnode`](https://github.com/oxc-project/oxc-node) (zero-config TypeScript runner) and are registered as `package.json` scripts.

```
scripts/
├── dist-manifest.ts    # Compatibility wrapper for @ayulab/repo-tools/dist-manifest
├── publish.ts          # Release entry point
├── setup.ts            # Register repo in Pi settings
├── teardown.ts         # Unregister repo from Pi settings
├── vitest.config.ts    # Script test config
├── lib/                # Shared modules (imported by scripts above)
│   ├── auto-bump.ts    # Patch bump planning for already-published changed packages
│   ├── build-artifact-stage.ts # Swap bundled workspace deps with built artifacts
│   ├── cli.ts          # CLI flag parser
│   ├── deps.ts         # Dependency graph + topological sort
│   ├── git.ts          # Git tag + GitHub Release automation
│   ├── npm.ts          # npm registry queries
│   ├── package-json.ts # package.json shape guard
│   ├── packages.ts     # Discover root + publishable workspace packages
│   ├── pi-settings.ts  # Pi settings.json helpers (setup / teardown)
│   ├── release-plan.ts # Release target expansion and dependency ordering
│   ├── release-preview.ts # Dry-run package version preview helpers
│   ├── release-targets.ts # Release target parsing and validation
│   ├── types.ts        # Shared interfaces (PkgJson, PackageInfo, DepGraph, ...)
│   ├── validate.ts     # Pre-publish manifest validation
│   └── version.ts      # Version parsing/comparison helpers
```

## Build

`pnpm run build`

Uses [Turborepo](https://turbo.build) to build all workspace packages in dependency order with caching. Private `internal/*` packages are built for local imports but are not published:

1. **Topology** — turbo resolves the dependency graph from `package.json` and builds packages so dependencies compile before dependents.
2. **Bundle** — each package runs `tsdown` to bundle `src/` into `dist/`.
3. **Generate `dist/package.json`** — `pi-dist-manifest` from `@ayulab/repo-tools` rewrites `main`/`exports`/`pi.extensions` paths (`.ts` → `.js`), strips `scripts`/`devDependencies`/`engines`, removes workspace dependencies, copies `README.md` when present, and writes `files` from actual `dist/` artifacts.
4. **Copy README** — copies `README.md` into `dist/`.

Run this before `pnpm run release`.

## `publish.ts` — Topological Publish

`pnpm run release` / `pnpm run release --dry-run`

Orchestrates npm publishing across the monorepo. Entry point that composes modules from `lib/`:

1. **Discovery** (`lib/packages.ts`) — scans `extensions/`, `sdk/`, and the root package for publishable packages. Private `internal/*` packages are intentionally excluded.
2. **Drift detection** (`lib/npm.ts`) — compares local versions against the npm registry.
3. **Auto-bump planning** (`lib/auto-bump.ts`) — if a package's current version is already published and its release inputs changed since the matching git tag, the script bumps patch version, commits, and pushes before publishing. If you manually set a new unpublished version, it is published as-is.
   3.5. **Committed-source guard** — release aborts when the scoped packages have uncommitted changes, so tags and GitHub Releases always point at an actual git commit.
4. **Dependency graph** (`lib/deps.ts`) — builds a graph from `package.json` `dependencies` and topologically sorts so dependencies are published before dependents.
5. **Validation** (`lib/validate.ts`) — enforces manifest compliance (`README.md` present, correct `keywords`/`pi.extensions` per package kind, `repository`/`homepage`/`bugs`, `publishConfig.access`, root `bundledDependencies` consistency). Fails fast on violations.
6. **Build** — runs `pnpm run build` (via Turborepo) to compile all workspace packages into `dist/` before publishing. Internal packages may produce local `dist/` artifacts, but they are not published.
7. **Publish + Tag + Release** — runs `pnpm publish` for each out-of-date package (child packages publish from `dist/` via `publishConfig.directory`). As soon as a package is successfully published, `lib/git.ts` immediately creates and pushes its git tag (`@scope/name@version`) and opens a GitHub Release. If a later package fails, earlier packages are never left untagged.

Flags:

| Flag                            | Short | Description                                             |
| ------------------------------- | ----- | ------------------------------------------------------- |
| `--dry-run`                     | —     | Preview what would be published without touching npm    |
| `--all`                         | `-a`  | Publish all out-of-date packages                        |
| `--package=<name>[,<name>...]`  | `-p`  | Publish specific package(s) and required workspace deps |
| `--access=<public\|restricted>` | —     | npm access level (default: `public`)                    |
| `--otp <code>`                  | —     | One-time password for two-factor authentication         |

`-p` and `-a` are mutually exclusive. If both are provided, `-p` wins.

Examples:

```bash
# Publish all out-of-date packages (default when no target is given)
pnpm run release

# Same as above, explicit
pnpm run release --all

# Publish a specific package (including required unpublished workspace deps)
pnpm run release -p @ayulab/pi-rewind

# Publish multiple specific packages
pnpm run release --package @ayulab/pi-rewind @ayulab/oh-my-pi @ayulab/pi-undo-redo
pnpm run release --package=@ayulab/pi-rewind,@ayulab/oh-my-pi,@ayulab/pi-undo-redo

# Publish with OTP
pnpm run release --otp 123456

# Dry-run preview
pnpm run release --dry-run
```

## `setup.ts` — Register in Pi Settings

`pnpm run setup`

Adds the repository root path to `~/.pi/agent/settings.json` under the `packages` array. This makes Pi aware of local extensions, skills, prompts, and themes without re-installing.

Displays the planned change and asks for `y` confirmation before writing.

Uses `lib/pi-settings.ts` for settings I/O and prompt handling.

## `teardown.ts` — Unregister from Pi Settings

`pnpm run teardown`

Removes the repository root path from `~/.pi/agent/settings.json`. Reverses `setup.ts`.

Skips if the path is not currently registered. Asks for `y` confirmation before writing.

Uses `lib/pi-settings.ts` for settings I/O and prompt handling.

## Adding New Shared Logic

If a new script needs functionality that other scripts might also need, extract it into `scripts/lib/` instead of duplicating:

1. Create `scripts/lib/<name>.ts` with a single, well-defined responsibility.
2. Export pure functions (no side effects) when possible.
3. Import from `lib/` using relative paths (no `.ts` extension): `import { foo } from "./lib/foo";`
4. Update this README with a one-line description.

## Adding a New Top-Level Script

1. Create `scripts/<name>.ts`.
2. Register it in `package.json` under `scripts`.
3. Import shared utilities from `scripts/lib/` rather than inlining.
4. Add a section to this README.
