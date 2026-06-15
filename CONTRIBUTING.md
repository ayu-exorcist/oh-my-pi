# Contributing

## Repository Overview

This repository is a [Pi Package](https://pi.dev/docs/latest/packages) named `@ayulab/oh-my-pi`, containing extensions, skills, prompts, and themes.

- `extensions/` — Publishable Pi extensions (`src/index.ts` entry point)
- `sdk/` — Publishable SDK packages consumed by extensions
- `internal/` — Private workspace packages that are built/tested but not published
- `scripts/` — Development and release automation
- `skills/` / `prompts/` / `themes/` — Content-only directories

## Environment Setup

### 1. Install mise

This project uses [mise](https://mise.jdx.dev/) to manage development tools. Install it first:

```bash
# macOS / Linux
curl https://mise.run | sh

# Windows (via winget)
winget install jdx.mise
```

### 2. Install project tools via mise

```bash
mise install
```

This reads `mise.toml` and installs the pinned versions of `node`, `pnpm`, `pi`, and `codegraph`.

### 3. Install dependencies

```bash
pnpm install
```

### 4. Build workspace packages

```bash
pnpm run build
```

This prepares the workspace packages and extension bundles used by local-path package operations such as `pi install /path/to/oh-my-pi` and `pi uninstall /path/to/oh-my-pi`. Pi installs package dependencies automatically, but it does not run the repository build for you.

If you want Pi to discover the checkout without package installation, use:

```bash
pnpm run setup
pnpm run teardown
```

`pnpm run setup` adds the repository root to `~/.pi/agent/settings.json`, and `pnpm run teardown` removes it again.

### 5. Initialize CodeGraph (optional)

If you plan to use CodeGraph for code navigation:

```bash
codegraph init -i
```

This indexes the repository and creates a `.codegraph/` directory.

### ⚠️ Package Conflict Warning

Pi loads extensions from multiple sources simultaneously. Installing the same package from different sources (e.g., npm global + local repo, or curated collection + standalone extension) will cause duplication or runtime errors. Use `pi list` to inspect active packages.

## Scripts

| Script                       | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `pnpm run dev`               | vitest watch mode                                   |
| `pnpm test`                  | Run all tests once                                  |
| `pnpm run coverage`          | Coverage report only                                |
| `pnpm run coverage:strict`   | Maintainer audit: 100% coverage enforcement         |
| `pnpm run coverage:open`     | Coverage report + serve on `http://localhost:9876`  |
| `pnpm run typecheck`         | TypeScript `tsc --noEmit`                           |
| `pnpm run lint` / `lint:fix` | oxlint                                              |
| `pnpm run fmt` / `fmt:check` | oxfmt                                               |
| `pnpm run check`             | Local full check (type + lint + fmt + test)         |
| `pnpm run verify`            | CI gate (type + lint + fmt + test)                  |
| `pnpm run build`             | Turborepo build all workspace packages into `dist/` |
| `pnpm run setup`             | Register repo in user-level Pi settings             |
| `pnpm run teardown`          | Unregister repo from user-level Pi settings         |
| `pnpm run changeset`         | Create a Changesets release note                    |
| `pnpm run version-packages`  | Apply Changesets version bumps + update lockfile    |
| `pnpm run release`           | Build, validate, and run Changesets publish         |
| `pnpm run release:dry`       | Dry-run preview of publish                          |
| `pnpm run clean`             | Remove coverage, caches, and tsbuildinfo            |

## Quality Gate

Before committing, run `pnpm run verify` locally:

- `tsc --noEmit` — zero errors
- `oxlint .` — zero errors
- `oxfmt . --check` — clean
- `vitest run` — all tests pass

Use `pnpm run coverage` when you want a plain coverage report during development.
Use `pnpm run coverage:strict` when you are the maintainer and need to audit or ratchet full-repo coverage.

GitHub Actions runs `pnpm changeset status --verbose` and `pnpm run verify` on every pull request. Maintainers can run `pnpm run coverage:strict` locally whenever they want to audit or ratchet full-repo coverage.

## Pull Request Workflow

All contributors and maintainers use the same protected-branch workflow. Work on a feature or bugfix branch, open a pull request into `main`, keep it up to date with `main`, wait for required CI checks, and merge only after review approval. Direct pushes, force pushes, branch deletion, stale pull requests, and missing required checks are blocked by the `main` ruleset.

User-facing changes to published packages must include a changeset in the same pull request. If one is missed after merge, add a follow-up changeset-only pull request before merging the generated release PR.

## Pull Request Workflow

All contributors and maintainers use the same protected-branch workflow. Work on a feature or bugfix branch, open a pull request into `main`, keep it up to date with `main`, wait for required CI checks, and merge only after review approval. Direct pushes, force pushes, branch deletion, stale pull requests, and missing required checks are blocked by the `main` ruleset.

User-facing changes to published packages must include a changeset in the same pull request. If one is missed after merge, add a follow-up changeset-only pull request before merging the generated release PR.

## Directory Conventions

### Adding an Extension

```
extensions/
└── <name>/
    ├── package.json      # Extension package config
    ├── README.md         # Shown on npm and pi.dev/packages
    ├── tsdown.config.ts  # tsdown bundle config
    ├── vitest.config.ts  # Vitest test config
    └── src/
        ├── index.ts      # Pi extension entry (exports default function)
        └── ...           # Source + tests
```

Entry `src/index.ts` should export the Pi extension factory as the default export:

```typescript
export default function activate(ctx: ExtensionContext): void {
  // Register tools, commands, or event hooks here.
}
```

Every `package.json` must include:

```json
{
  "publishConfig": {
    "access": "public",
    "directory": "dist"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/ayu-exorcist/oh-my-pi.git",
    "directory": "extensions/<name>"
  },
  "homepage": "https://github.com/ayu-exorcist/oh-my-pi/tree/main/extensions/<name>#readme",
  "bugs": {
    "url": "https://github.com/ayu-exorcist/oh-my-pi/issues"
  }
}
```

Build config (`tsdown.config.ts`):

```typescript
import { createTsdownConfig } from "@ayulab/repo-tools/tsdown";
import { defineConfig } from "tsdown";

export default defineConfig(
  createTsdownConfig({
    alwaysBundle: ["@ayulab/pi-checkpoint", "@ayulab/runtime-core"],
  }),
);
```

If the extension ships runtime prompt templates or other assets, pass package-specific tsdown options alongside the shared preset:

```typescript
import { createTsdownConfig } from "@ayulab/repo-tools/tsdown";
import { defineConfig } from "tsdown";

export default defineConfig({
  ...createTsdownConfig(),
  copy: "prompts",
});
```

If the extension depends on workspace runtime packages, list them in `dependencies` and bundle internal helpers:

```json
{
  "dependencies": {
    "@ayulab/pi-checkpoint": "workspace:*",
    "@ayulab/runtime-core": "workspace:*"
  }
}
```

### Adding a Sub-package to `sdk/`

```
sdk/
└── <name>/
    ├── package.json
    ├── README.md         # Shown on npm
    ├── tsdown.config.ts  # tsdown bundle config
    ├── vitest.config.ts  # Vitest test config
    └── src/
        ├── index.ts
        └── ...
```

Package config (do **not** include `"pi-package"` in `keywords` for SDK-only libraries):

```json
{
  "publishConfig": {
    "access": "public",
    "directory": "dist"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/ayu-exorcist/oh-my-pi.git",
    "directory": "sdk/<name>"
  },
  "homepage": "https://github.com/ayu-exorcist/oh-my-pi/tree/main/sdk/<name>#readme",
  "bugs": {
    "url": "https://github.com/ayu-exorcist/oh-my-pi/issues"
  }
}
```

Build config (`tsdown.config.ts`):

```typescript
import { createTsdownConfig } from "@ayulab/repo-tools/tsdown";
import { defineConfig } from "tsdown";

export default defineConfig(
  createTsdownConfig({
    dts: true,
  }),
);
```

### Adding an Internal Package

Internal packages live under `internal/`, must set `"private": true`, and are not published by `scripts/publish.ts`.

Use `internal/runtime-core` for shared runtime helpers that published packages bundle into their output. Keep it zero-dependency unless there is a deliberate architectural reason to add a dependency.

Use `internal/repo-tools` for shared build, Vitest, release, and repository-maintenance helpers. Runtime source under `extensions/` and `sdk/` must not import `@ayulab/repo-tools`; only configs, scripts, and tests should use it.

### Adding a Theme

Drop a `.json` file directly into `themes/`:

```
themes/
└── <name>.json
```

Pi auto-loads all `.json` files from `pi.themes` directories declared in `package.json`.

### Adding a Skill / Prompt

```
skills/
└── <name>/
    └── SKILL.md

prompts/
└── <name>/
    └── prompt.md
```

## Code Standards

### Extract Shared Logic

If multiple packages need the same logic, do not duplicate it. Choose the destination by API stability and runtime boundary:

- Use `internal/runtime-core` for private zero-dependency runtime helpers that are bundled into published packages, such as guards and error helpers.
- Use `sdk/<name>/` for publishable SDK APIs that external consumers may import directly.
- Use `internal/repo-tools` for build, test, release, and repository-maintenance helpers.
- Keep domain-specific extension logic in the owning extension until a second real consumer appears.

Examples:

- `pi-rewind` reads checkpoint entries from sessions → stable checkpoint APIs live in `@ayulab/pi-checkpoint`.
- Runtime type guards shared by extensions and scripts live in private `@ayulab/runtime-core` and are bundled away from published manifests.
- If a third extension needs a parser from `pi-rewind`, consider promoting it to `sdk/` only if it should become a public SDK API.

### Cross-platform Path Handling

The project supports Linux, macOS, and Windows.

**Do:**

- Use `node:path` for all filesystem paths (`path.join`, `path.resolve`, `path.relative`).
- Use `path.relative` for path-string comparisons instead of `startsWith`.

**Don't:**

- Hard-code `/` separators: `path.split("/")` ❌
- Manually replace `\\` for comparisons: `.replace(/\\\\/g, "/")` ❌

Exception: when normalizing paths returned by external systems (e.g., CodeGraph native bindings), use `/[\/\\\\]/` to match both separators.

### Type Safety

- Prefer `unknown` over `any`.
- Use `interface` for object shapes; use `type` for unions and complex types.
- Leverage type inference when possible.
- Use const assertions (`as const`) to preserve literal types.
- Avoid type assertions (`as`) and non-null assertions (`!`) in production code; use type guards instead.
- Document complex types with JSDoc.

### Build & Release

**Build** — `pnpm run build` uses [Turborepo](https://turbo.build) to build all workspace packages in dependency order with caching:

- `internal/runtime-core` → private runtime helper bundle used only inside the monorepo
- `sdk/pi-checkpoint` → single-file bundle (`index.js` + `index.d.ts`)
- `extensions/pi-rewind` → extension bundle that emits deterministic dependency chunks such as `@ayulab__pi-checkpoint.js` for `@ayulab/pi-checkpoint`
- `dist/package.json` is auto-generated by `pi-dist-manifest` from `@ayulab/repo-tools` (paths rewritten, `workspace:*` removed, `scripts`/`devDependencies` stripped)

Describe PRs clearly enough that reviewers can understand the change, the motivation, and how you verified it. The PR template is only a lightweight prompt; keep the summary concise and use Notes for anything useful to reviewers.

Create a Changesets entry for user-facing package changes before merging. Add it in the same PR as the feature or bug fix so the generated release PR can preserve the correct version and changelog history:

```bash
pnpm run changeset
```

Pull requests that affect published packages should not be merged without a changeset. For infrastructure-only changes that should not publish packages, create an empty changeset:

```bash
pnpm changeset add --empty
```

The `Prepare Release PR` workflow creates and updates the version PR automatically after changesets reach `main`. Keep that release PR open to accumulate multiple changes, then merge it when you are ready to release. The release PR follows the same branch protection rules as every other pull request: it must be up to date with `main`, pass required CI checks, and receive the required review approval before merging.

For local recovery, maintainers can apply pending version bumps and update the lockfile manually:

```bash
pnpm run version-packages
```

Normal releases should use the generated release PR instead of manual version commits. `pnpm run release` builds, validates, and delegates npm publishing plus git tag creation to `changeset publish`.

**Always use `pnpm` to publish.** This monorepo uses pnpm workspaces with `workspace:*` dependency references. Only `pnpm publish` resolves `workspace:*` to concrete version numbers during tarball generation. Using `npm publish` will ship the literal string `workspace:*` to the registry, breaking installation for consumers.

```bash
# Maintainer recovery only: publish current unpublished package versions
pnpm run release

# Wrong — npm does not understand workspace:*
npm publish
```

**`.npmrc`** — root only, enables npm provenance (supply-chain attestation):

```
provenance=true
```

**Pre-publish validation** — `scripts/publish.ts` discovers publishable packages from `extensions/`, `sdk/`, and the root package only; packages marked `private: true` and private `internal/*` packages are built and tested but not published. Missing `README.md`, `repository`, `homepage`, `bugs`, or incorrect `keywords` / `pi.extensions` will abort the release with a clear error.

**Release credentials** — npm publishing uses Trusted Publishing / OIDC, with package publishing access set to `Require two-factor authentication and disallow tokens`. GitHub Actions uses the built-in `GITHUB_TOKEN` plus `id-token: write`; no `NPM_TOKEN` secret is required.

**Git tags** — `changeset publish` creates package tags automatically. Format: `@scope/name@version`. The `Release` workflow pushes those tags after publishing succeeds. For manual local releases, run `git push --follow-tags` after `pnpm run release`.

**Release workflow** — `Prepare Release PR` runs automatically on `main` pushes and only creates or updates the Changesets release PR. The `Release` workflow runs after the `changeset-release/main` PR is merged, verifies no pending `.changeset/*.md` files remain, then publishes packages and tags.

**GitHub Releases** — disabled in the release workflow; npm packages and git tags are the release artifacts.

### Commit Rules

- One behavior per commit.
- TDD: write tests before implementation.
- No `any` / `as` / `!` in production code.
- No `console.log` in production code (use `ctx.ui.notify`).
