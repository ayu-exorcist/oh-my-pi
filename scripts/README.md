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
│   ├── cli.ts          # CLI flag parser
│   ├── deps.ts         # Dependency graph helpers
│   ├── git.ts          # Dirty release input detection
│   ├── package-json.ts # package.json shape guard
│   ├── packages.ts     # Discover root + publishable workspace packages
│   ├── pi-settings.ts  # Pi settings.json helpers (setup / teardown)
│   ├── types.ts        # Shared interfaces (PkgJson, PackageInfo, DepGraph, ...)
│   └── validate.ts     # Pre-publish manifest validation
```

## Build

`pnpm run build`

Uses [Turborepo](https://turbo.build) to build all workspace packages in dependency order with caching. Private `internal/*` packages are built for local imports but are not published:

1. **Topology** — turbo resolves the dependency graph from `package.json` and builds packages so dependencies compile before dependents.
2. **Bundle** — each package runs `tsdown` to bundle `src/` into `dist/`.
3. **Generate `dist/package.json`** — `pi-dist-manifest` from `@ayulab/repo-tools` rewrites `main`/`exports`/`pi.extensions` paths (`.ts` → `.js`), strips `scripts`/`devDependencies`/`engines`, removes workspace dependencies, copies `README.md` when present, and writes `files` from actual `dist/` artifacts.
4. **Copy README** — copies `README.md` into `dist/`.

`pnpm run release` runs this automatically before publishing. Run it directly for local build validation.

## `publish.ts` — Changesets Publish Wrapper

`pnpm run release` / `pnpm run release:dry`

The `Release` GitHub Actions workflow calls `pnpm run release` after the generated `changeset-release/main` PR is merged. Local release commands are for maintainer recovery and dry-run validation; normal releases should happen by merging the generated release PR.

Runs project-specific pre-publish checks, then delegates package publishing and git tag creation to Changesets:

1. **Discovery** (`lib/packages.ts`) — scans `extensions/`, `sdk/`, and the root package for publishable packages. Workspace packages marked `private: true` and private `internal/*` packages are intentionally excluded.
2. **Committed-source guard** — release aborts when publishable package inputs have uncommitted changes, so Changesets tags point at an actual git commit.
3. **Validation** (`lib/validate.ts`) — enforces manifest compliance (`README.md` present, correct `keywords`/`pi.extensions` per package kind, `repository`/`homepage`/`bugs`, `publishConfig.access`, root `bundledDependencies` consistency). Fails fast on violations.
4. **Build** — runs `pnpm run build` (via Turborepo) to compile all workspace packages into `dist/` before publishing.
5. **Changesets publish** — runs `pnpm changeset publish`, which publishes unpublished package versions and creates package git tags.

Flags:

| Flag           | Short | Description                                          |
| -------------- | ----- | ---------------------------------------------------- |
| `--dry-run`    | —     | Preview what would be published without touching npm |
| `--otp <code>` | —     | One-time password for manual local publishing        |

Targeted publish flags (`--package`, `-p`, `--all`, `-a`, and positional package names) are intentionally unsupported. Choose release packages with Changesets instead. Access is configured in `.changeset/config.json` and per-package `publishConfig`.

Examples:

```bash
# Validate release inputs and print Changesets status without publishing
pnpm run release:dry

# Maintainer recovery only: publish unpublished package versions and create tags
pnpm run release

# Maintainer recovery only: publish with OTP
pnpm run release --otp 123456
```

## `setup.ts` — Register in Pi Settings

`pnpm run setup`

Adds the repository root path to `~/.pi/agent/settings.json` under the `packages` array. This makes Pi aware of local extensions, skills, prompts, and themes without repeated `pi install` / `pi uninstall` cycles.

Use this during active development when you want the checkout to stay visible to Pi.

Displays the planned change and asks for `y` confirmation before writing.

Uses `lib/pi-settings.ts` for settings I/O and prompt handling.

## `teardown.ts` — Unregister from Pi Settings

`pnpm run teardown`

Removes the repository root path from `~/.pi/agent/settings.json`. Reverses `setup.ts`.

Use this to stop Pi from loading the checkout after development or testing.

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
