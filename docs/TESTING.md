# Testing

## Framework

Vitest. Run the full suite with:

```bash
pnpm test          # all packages once
pnpm run dev       # watch mode
pnpm run coverage  # with 100% threshold enforcement
```

## Mock Strategy

The checkpoint SDK uses a **RepoProvider seam** to avoid filesystem I/O in unit tests:

- Production: `createDefaultRepoProvider()` (Map-backed, filesystem-aware)
- Tests: inject `createMockRepo()` via custom provider

This makes `pi-rewind` and `pi-undo-redo` command logic 100% testable without temp directories.

## Coverage

Thresholds (enforced by CI):

| Metric     | Threshold |
| ---------- | --------- |
| Statements | 100%      |
| Branches   | 100%      |
| Functions  | 100%      |
| Lines      | 100%      |

Provider: `@vitest/coverage-v8`.

## Cross-platform Path Handling

All filesystem paths must use `node:path`. Tests that compare paths should use `path.relative` or `path.normalize` rather than string `startsWith` or `/` splitting.

When normalizing paths from external systems (e.g., CodeGraph native bindings), use `/[/\\]/` regex to match both separators.

## Testing Commands by Package

```bash
# SDK
pnpm --filter @ayulab/pi-checkpoint test

# Extensions
pnpm --filter @ayulab/pi-rewind test
pnpm --filter @ayulab/pi-undo-redo test
pnpm --filter @ayulab/pi-clarify test
pnpm --filter @ayulab/pi-workflow test
pnpm --filter @ayulab/pi-trace-lab test

# Scripts
pnpm --filter oh-my-pi-scripts test
```

## Adding Tests

- Write tests before implementation (TDD).
- Name tests like behavior specs: `describe("restoreUndoTarget")` + `it("checks out beforeCommit and navigates tree")`.
- Avoid over-mocking; prefer the RepoProvider seam for checkpoint tests.
- No `any`, unsafe `as`, or non-null `!` in test code.
