# AGENTS.md

> Project type: Pi extensions / package monorepo (pnpm workspace)
> Tech stack: TypeScript (ESM), Node.js
> Entry doc: README.md
> Final outputs: `dist/` (package build artifacts), published packages
> Extension runtime: full system permissions (privileged harness code)

## Project

- `@ayulab/oh-my-pi` is a pnpm workspace and Pi package monorepo.
- It ships Pi extensions, packageable skills/prompts/themes, and shared SDK code.
- Extensions run with full system permissions; treat all extension code as privileged runtime harness code.

## Read First

1. This file.
2. `README.md` and `CONTRIBUTING.md` for package structure, commands, and release rules.
3. `CONTEXT-MAP.md`, then only the relevant context docs and ADRs in `docs/adr/`.
4. For full harness rules (T0–T4 tiers, capability review, release safety): read `docs/agents/ai-harness.md`.

## Commands

Use pnpm and mise; do not switch package managers.

- Install: `mise install && pnpm install`
- Local check: `pnpm run check`
- CI gate: `pnpm run ci`
- Build: `pnpm run build`
- Release dry run: `pnpm run release:dry`

## Pi Collaboration Rules

- Check `.pi/skills/` and `.agents/skills/` at session start; follow any relevant `SKILL.md`.
- Do not skip skill workflows, checklists, or stop conditions.
- Update `~/.pi/agent/ayu/workspace/journal.md` at session end if it exists.

## Change Scope

- One behavior change per task; prefer small vertical slices.
- Do not do unrelated refactors, formatting churn, dependency bumps, or lockfile changes.
- Do not edit `package.json`, `pnpm-lock.yaml`, release scripts, `.npmrc`, GitHub Actions, or `dist/` unless the task requires it.

## Coding Rules

Follow `CONTRIBUTING.md`:

- TypeScript ESM. Prefer `unknown` over `any`. No `any`, unsafe `as`, or non-null `!` in production code.
- No `console.log` in production code; use `ctx.ui.notify`.
- Use `node:path` and `path.relative` for paths; do not hard-code `/` separators.
- Extract shared logic to `sdk/` instead of duplicating.
- For bug fixes, reproduce first when practical and add/adjust tests before the fix.

## Tool Permission Matrix

Judge by side effect, not by tool name. See `docs/agents/ai-harness.md` for the full policy.

- **T0 read**: Read files, search, read-only logs. Default allowed; reject secrets/PII.
- **T1 write-local**: Modify workspace files, generate local artifacts. Allowed for small scope; protect sensitive paths.
- **T2 external-send**: Web search, fetch external content, HTTP POST. Must note risk and source bias.
- **T3 irreversible**: Bulk delete, data migration, rename/move directories. Default deny; provide dry-run if required.
- **T4 production-mutating**: Publish, release, push, modify production config. Default deny; requires explicit approval.

Permission enforcement is handled by bundled local extension `@ayulab/pi-permission-system`.

## Constraints

- Keep Clarify, Rewind, UndoRedo, and checkpoint semantics intact.
- Do not weaken safety gates or release validation without explicit approval and regression tests.
- Do not add network, filesystem, shell, MCP, browser, publish, or release side effects without calling out the risk tier and verification plan (see `docs/agents/ai-harness.md` for T0–T4 tiers).
- Do not commit, tag, push, publish, or run `pnpm run release` unless explicitly requested.
- Use `pnpm run release:dry` for release-readiness checks.

## Secret Safety

- Do not print, copy, or expose full secrets, tokens, API keys, cookies, or private credentials.
- If a secret is found in a file, mention only the file path and secret type, then recommend rotation.
- Prefer environment variables or secret-manager commands over literal secrets in config files.

## Git Safety

- Do not run destructive git commands (e.g., `git reset --hard`, forced push to `main`) unless explicitly requested.
- Do not commit, tag, push, publish, or release unless explicitly requested.

## Harness Self-Iteration

- When modifying AI rules, templates, skills, or prompt code, record the failure fact, change hypothesis, target metric, and rollback standard first.
- Do not append long-term rules from a single failure; record to `.pi/ayu/tasks/ai-notes.md` or an iteration card first.
- Important harness changes must use a fixed benchmark suite for before/after comparison.
- Prompt/skill/tool description changes prefer bounded add/delete/replace; record rejected variants; do not promote solely based on LLM judgment that text is "better."
- Prefer mechanizing rules into tests, lint, schema, CI, or hooks; keep natural language rules short.
- Changing models or tools requires a separate baseline; do not count model improvement as harness improvement.

## Verification

- Prefer evidence over self-assessment: run `pnpm run check` or the relevant test suite before claiming completion.
- For bug fixes, reproduce the issue before fixing when practical; otherwise explain why reproduction was not possible.
- Report exact files changed, commands run and exact outcomes, tests or checks not run with reason, and any residual risk.
