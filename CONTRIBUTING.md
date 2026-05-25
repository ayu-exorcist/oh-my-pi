# Contributing

## Repository Overview

This repository is a [Pi Package](https://pi.dev/docs/latest/packages) named `@ayulab/oh-my-pi`, containing extensions, skills, prompts, and themes.

- `extensions/` — Pi extensions (`index.ts` entry point)
- `skills/` / `prompts/` / `themes/` — Content-only directories
- `sdk/` — Shared libraries consumed by extensions
- `scripts/` — Development and release automation

## Environment Setup

**pnpm is required:**

```bash
cd ~/ayu-pi
pnpm install
```

### Register as a Pi Package (optional)

To make Pi aware of this repository's extensions, skills, prompts, and themes from outside the project directory:

```bash
pnpm run setup      # register in ~/.pi/agent/settings.json
pnpm run teardown   # unregister
```

These scripts modify the user-level Pi settings so the package is available globally in your Pi environment. They are safe to run multiple times (idempotent).

## Scripts

| Script                       | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `pnpm run dev`               | vitest watch mode                                               |
| `pnpm test`                  | Run all tests once                                              |
| `pnpm run coverage`          | Tests + 100% coverage enforcement                               |
| `pnpm run coverage:open`     | Coverage report + serve on `http://localhost:9876`              |
| `pnpm run typecheck`         | TypeScript `tsc --noEmit`                                       |
| `pnpm run lint` / `lint:fix` | oxlint                                                          |
| `pnpm run fmt` / `fmt:check` | oxfmt                                                           |
| `pnpm run check`             | Local full check (type + lint + fmt + test)                     |
| `pnpm run ci`                | CI gate (type + lint + fmt + coverage)                          |
| `pnpm run setup`             | Register repo in user-level Pi settings                         |
| `pnpm run teardown`          | Unregister repo from user-level Pi settings                     |
| `pnpm run release`           | Topological publish + auto CHANGELOG + git tag + GitHub Release |
| `pnpm run release --dry-run` | Dry-run preview of publish                                      |
| `pnpm run clean`             | Remove coverage, caches, and tsbuildinfo                        |

## Quality Gate

Before committing, run `pnpm run ci` locally:

- `tsc --noEmit` — zero errors
- `oxlint .` — zero errors
- `oxfmt . --check` — clean
- `vitest run --coverage` — 100% threshold

GitHub Actions runs `pnpm run ci` on every pull request as the final gate.

## Directory Conventions

### Adding an Extension

```
extensions/
└── <name>/
    ├── index.ts          # Pi extension entry (exports default function)
    ├── package.json      # Extension package config
    ├── README.md         # Shown on npm and pi.dev/packages
    ├── vitest.config.ts  # Optional
    └── src/
        ├── index.ts      # Extension logic
        └── ...           # Source + tests
```

Entry `index.ts` example:

```typescript
export { default } from "./src/index";
```

Every `package.json` must include:

```json
{
  "files": ["src", "index.ts", "README.md"],
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

If the extension depends on `@ayulab/pi-checkpoint`:

```json
{
  "dependencies": {
    "@ayulab/pi-checkpoint": "workspace:*"
  }
}
```

### Adding a Sub-package to `sdk/`

```
sdk/
└── <name>/
    ├── package.json
    ├── README.md         # Shown on npm
    ├── vitest.config.ts  # Optional
    └── src/
        ├── index.ts
        └── ...
```

Package config (do **not** include `"pi-package"` in `keywords` for SDK-only libraries):

```json
{
  "files": ["src", "README.md"],
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

### Extract Shared Logic into `sdk/`

If multiple extensions need the same logic, do not duplicate it. Extract shared code into `sdk/<name>/` and reference it via `dependencies`.

Examples:

- `pi-rewind` and `pi-undoredo` both read checkpoint entries from sessions → `extractCheckpointData()` lives in `@ayulab/pi-checkpoint`.
- If a third extension needs a parser from `pi-rewind`, consider promoting it to `sdk/`.

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

### Release Configuration

**`.npmrc`** — root only, enables npm provenance (supply-chain attestation):

```
provenance=true
```

**`CHANGELOG.md`** — auto-generated by `scripts/publish.ts`. Do not edit manually; each curated release prepends a new entry.

**Pre-publish validation** — `scripts/publish.ts` enforces manifest compliance before any package reaches npm. Missing `files`, `README.md`, `repository`, `homepage`, `bugs`, or incorrect `keywords` / `pi.extensions` will abort the release with a clear error.

**GitHub Releases** — `pnpm run release` auto-creates a GitHub Release for every published package via the `gh` CLI. Make sure `gh` is installed and authenticated:

```bash
gh auth status
```

**Git tags** — also created automatically. Format: `@scope/name@version`. Existing tags are skipped.

### Commit Rules

- One behavior per commit.
- TDD: write tests before implementation.
- No `any` / `as` / `!` in production code.
- No `console.log` in production code (use `ctx.ui.notify`).
