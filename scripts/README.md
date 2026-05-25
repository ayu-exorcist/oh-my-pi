# scripts/

Development and release automation for the `@ayulab/oh-my-pi` monorepo.

All top-level scripts are TypeScript files executed via [`oxnode`](https://github.com/oxc-project/oxc-node) (zero-config TypeScript runner) and are registered as `package.json` scripts.

```
scripts/
├── publish.ts          # Release entry point
├── setup.ts            # Register repo in Pi settings
├── teardown.ts         # Unregister repo from Pi settings
├── lib/                # Shared modules (imported by scripts above)
│   ├── cli.ts          # CLI flag parser
│   ├── guards.ts       # Type guards (isRecord, isStringArray, isPkgJson)
│   ├── types.ts        # Shared interfaces (PkgJson, PackageInfo, DepGraph, ...)
│   ├── packages.ts     # Discover root + workspace packages
│   ├── deps.ts         # Dependency graph + topological sort
│   ├── npm.ts          # npm registry queries
│   ├── changelog.ts    # CHANGELOG.md generation
│   ├── validate.ts     # Pre-publish manifest validation
│   ├── git.ts          # Git tag + GitHub Release automation
│   └── pi-settings.ts  # Pi settings.json helpers (setup / teardown)
```

## `publish.ts` — Topological Publish

`pnpm run release` / `pnpm run release --dry-run`

Orchestrates npm publishing across the monorepo. Entry point that composes modules from `lib/`:

1. **Discovery** (`lib/packages.ts`) — scans `extensions/` and `sdk/` for publishable packages.
2. **Drift detection** (`lib/npm.ts`) — compares local versions against the npm registry.
3. **Dependency graph** (`lib/deps.ts`) — builds a graph from `package.json` `dependencies` and topologically sorts so dependencies are published before dependents.
4. **Validation** (`lib/validate.ts`) — enforces manifest compliance (`files` includes `README.md`, correct `keywords`/`pi.extensions` per package kind, `repository`/`homepage`/`bugs`, `publishConfig.access`, root `bundledDependencies` consistency). Fails fast on violations.
5. **Publish + Tag + Release** — runs `pnpm publish` for each out-of-date package. As soon as a package is successfully published, `lib/git.ts` immediately creates and pushes its git tag (`@scope/name@version`) and opens a GitHub Release. If a later package fails, earlier packages are never left untagged.
6. **CHANGELOG** (`lib/changelog.ts`) — after the root package is published, queries the npm registry for every bundled dependency's exact version, then prepends a `CHANGELOG.md` entry. This ensures `workspace:*` placeholders never leak into the release log.

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
