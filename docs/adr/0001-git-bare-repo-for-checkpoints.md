# ADR-0001: Git Bare Repository as Checkpoint Backend

## Status

Accepted

## Context

`oh-my-pi` needs a mechanism to snapshot the workspace at the start and end of every agent turn, then restore it on demand via `/rewind`, `/undo`, and `/redo` commands. The requirements are:

- **File-level granularity**: capture every file change, not just a coarse-grained project state.
- **Deduplication**: avoid storing redundant copies when nothing changed.
- **Speed**: checkpointing must be fast enough to run on every turn (hundreds of times per session).
- **Familiarity**: users and agents already understand git semantics.
- **Portability**: no extra services, databases, or native dependencies beyond what developers already have.

Options considered:

1. **Custom diff/patch system** — Write raw file copies to a directory, maintain our own delta format.
2. **Simple tar snapshots** — Tar the workspace at each checkpoint, store sequentially.
3. **Git bare repo with external work tree** — Use a bare `.git` directory per session, set `GIT_WORK_TREE` to the project directory.

## Decision

Use **git bare repositories with external work trees** as the checkpoint backend.

Each session gets its own bare repo under `~/.pi/agent/checkpoints/sessions/<session-name>/.git`. The work tree points to the user's project directory. `RepoManager` sets `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` environment variables so all git commands operate on this isolated repo without interfering with the user's own `.git`.

## Consequences

### Positive

- **Deduplication for free**: git's object model deduplicates identical content across checkpoints.
- **Fast incremental snapshots**: `git add -A` + `git commit` is extremely fast for typical agent turn sizes.
- **Rich inspection**: `git log`, `git diff`, `git show` give us line-level statistics and history for free.
- **No new dependencies**: git is already required for almost all software projects.
- **Rollback safety**: git's atomic commits let us implement `safeCheckout` with safety-commit + rollback.

### Negative

- **Git binary dependency**: checkpointing fails if git is not installed (acceptable for the target audience).
- **Binary file handling**: git diff `--numstat` reports `-` for binaries; `diff-parser.ts` must map these to `0/0`.
- **Large file/repository limits**: very large files or repos may slow down checkpointing.
- **Separate index file**: we must manage `GIT_INDEX_FILE` outside the work tree to avoid colliding with the user's own git index.
- **Cross-process locking**: multiple Pi processes could access the same bare repo; `lock.ts` implements a `mkdir`-based filesystem lock.

## Related

- `sdk/pi-checkpoint/src/repo-manager.ts`
- `sdk/pi-checkpoint/src/lock.ts`
- `sdk/pi-checkpoint/src/resolver.ts`
