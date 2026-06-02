# ADR-0002: SDK / Extension Split with RepoProvider Testing Seam

## Status

Accepted

## Context

The checkpoint system has two distinct audiences:

1. **End users** interact via commands like `/rewind`, `/undo`, `/redo`.
2. **Extension authors** may want to build new checkpoint-aware commands without reimplementing the git backend.

Initially, everything could have lived in one extension package. But we anticipated that future extensions (e.g., a `/branch` command that forks checkpoints visually) would need the same core primitives.

## Decision

Split the codebase into three packages:

- **`sdk/pi-checkpoint`** — Reusable engine. Zero external dependencies. Exports `RepoManager`, config loading, diff parsing, type guards, and a testing module.
- **`extensions/pi-rewind`** — User-facing extension. Registers `turn_start`/`turn_end` hooks for automatic checkpointing and the `/rewind` command.
- **`extensions/pi-undo-redo`** — User-facing extension. Registers `/undo` and `/redo` commands. Does not create checkpoints; it consumes `CheckpointEntry` metadata written by `pi-rewind` (or any other extension).

Both extensions depend on `sdk/pi-checkpoint` via `workspace:*`.

### The RepoProvider Seam

`RepoManager` operates on the real filesystem. For unit tests, we needed a way to inject mock repos without `vi.spyOn` on internal module imports. We introduced `RepoProvider`:

```ts
interface RepoProvider {
  getRepo(sessionId: string): RepoManager | undefined;
  setRepo(sessionId: string, repo: RepoManager): void;
  deleteRepo(sessionId: string): void;
}
```

Production uses `createDefaultRepoProvider()` (Map-backed). Tests inject `createMockRepo()` objects via a custom provider. This makes `pi-undo-redo` testable without any filesystem I/O.

## Consequences

### Positive

- **Reusability**: new extensions can depend on `@ayulab/pi-checkpoint` without pulling in UI commands.
- **Testability**: `RepoProvider` + `createMockRepo()` let us unit-test command logic at 100% coverage without temp directories.
- **Separation of concerns**: SDK handles git mechanics; extensions handle Pi event bindings and UX.
- **Independent versioning**: SDK can be published and versioned separately from extensions.

### Negative

- **Workspace complexity**: pnpm workspace adds setup overhead for new contributors.
- **API surface maintenance**: every exported function in the SDK becomes a public contract.
- **Cross-package refactors**: renaming a type in the SDK requires updates in multiple packages.

## Related

- `sdk/pi-checkpoint/src/repo-provider.ts`
- `sdk/pi-checkpoint/src/testing/index.ts`
- `extensions/pi-rewind/package.json`
- `extensions/pi-undo-redo/package.json`
