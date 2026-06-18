# scripts/

Development and release automation for the `@ayulab/oh-my-pi` monorepo.

Top-level automation scripts are TypeScript files executed via [`oxnode`](https://github.com/oxc-project/oxc-node) when exposed through `package.json` scripts or direct maintainer commands.

```
scripts/
├── dist-manifest.ts        # Compatibility wrapper for @ayulab/repo-tools/dist-manifest
├── pre-commit.ts           # Local hook: format, lint-fix, restage, then check
├── publish-packages.ts     # Build, validate, and publish with Changesets
├── release.ts              # Release orchestration entry point
├── setup.ts                # Register repo in Pi settings
├── sync-release-tags.ts    # Push newly created Changesets tags to origin
├── teardown.ts             # Unregister repo from Pi settings
├── vitest.config.ts        # Script test config
├── lib/                    # Shared modules (imported by scripts above)
│   ├── cli.ts              # CLI flag parser
│   ├── deps.ts             # Dependency graph helpers
│   ├── git.ts              # Dirty release input detection
│   ├── package-json.ts     # package.json shape guard
│   ├── packages.ts         # Discover root + workspace packages
│   ├── pi-settings.ts      # Pi settings.json helpers (setup / teardown)
│   ├── release-args.ts     # Supported release flag parsing and rejection
│   ├── select-release-tags.ts # Local/remote tag selection helpers
│   ├── types.ts            # Shared interfaces and workspace directory constants
│   └── validate.ts         # Pre-publish manifest validation
```

## Build

`pnpm run build`

Uses [Turborepo](https://turbo.build) to build all workspace packages in dependency order with caching. Private `internal/*` packages are built for local imports but are not published:

1. **Topology** — turbo resolves the dependency graph from `package.json` and builds packages so dependencies compile before dependents.
2. **Bundle** — each package runs `tsdown` to bundle `src/` into `dist/`.
3. **Generate `dist/package.json`** — `pi-dist-manifest` from `@ayulab/repo-tools` rewrites `main`/`exports`/`pi.extensions` paths (`.ts` → `.js`), strips `scripts`/`devDependencies`/`engines`, removes workspace dependencies, copies `README.md` when present, and writes `files` from actual `dist/` artifacts.

`pnpm run release` runs this automatically before publishing. Run it directly for local build validation.

## `release.ts` — Release Flow

`pnpm run release` / `pnpm run release:dry`

This is the single release entry point used by GitHub Actions and local maintainer recovery.

What `pnpm run release` does:

1. validates the release scope and package manifests
2. runs the workspace build
3. publishes unpublished packages with Changesets
4. syncs the newly created git tags to `origin`

`pnpm run release:dry` runs the same validation and build, then prints `pnpm changeset status --verbose` without publishing packages or creating tags.

Flags:

| Flag           | Short | Description                                          |
| -------------- | ----- | ---------------------------------------------------- |
| `--dry-run`    | —     | Preview what would be published without touching npm |
| `--otp <code>` | —     | One-time password for manual local publishing        |

Targeted publish flags (`--package`, `-p`, `--all`, `-a`, and positional package names) are intentionally unsupported. Choose release packages with Changesets instead.

Examples:

```bash
pnpm run release:dry
pnpm run release
pnpm run release --otp 123456
```

## `setup.ts` — Register in Pi Settings

`pnpm run setup`

Adds the repository root path to `~/.pi/agent/settings.json` under the `packages` array. This makes Pi aware of local extensions and package resources without repeated `pi install` / `pi uninstall` cycles.

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
