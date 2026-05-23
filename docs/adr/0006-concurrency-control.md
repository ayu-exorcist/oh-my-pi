# ADR-0006: mkdir-Based Cross-Process Filesystem Lock

## Status

Accepted

## Context

`RepoManager` wraps git operations that modify the working tree and the bare repo. In a Pi environment, multiple processes could theoretically access the same session repo:

- A long-running Pi server and a CLI command.
- Two agent instances operating on the same session.
- A checkpoint operation racing with an undo command.

Git itself is not safe for concurrent operations on the same working tree with a shared index. We need serialization.

Options considered:

1. **In-memory mutex** (`async-mutex` or a simple Promise queue) — Only works within a single Node.js process. Useless across separate Pi invocations.
2. **File-based lock with `flock`** — Portable on Unix, but `flock` is not available on Windows without native modules.
3. **`mkdir`-based lock** — Create a directory. Directory creation is atomic on all POSIX filesystems. Windows also supports atomic directory creation. No native dependencies.
4. **Git's built-in locking** (`git lock`) — Does not exist in standard git. Index locks (`index.lock`) are internal and transient.

## Decision

Use **`mkdir`-based filesystem locking** with automatic stale-lock detection.

Implementation in `lock.ts`:

- Lock path: `<repoDir>/.pi-checkpoint-lock/`
- Acquire: attempt `fs.mkdir(lockPath)`. If `EEXIST`, stat the directory. If older than 30s, assume the previous process crashed and remove it.
- Release: `fs.rmdir(lockPath)` in a `finally` block.
- Polling interval: 50ms.

`RepoManager.safeCheckout` wraps its entire critical section in `withLock`.

## Consequences

### Positive

- **Cross-process and cross-platform**: works on macOS, Linux, and Windows without native modules.
- **Crash recovery**: stale locks older than 30s are automatically broken.
- **Zero dependencies**: no npm packages required.

### Negative

- **30s stale threshold is arbitrary**: a process genuinely holding the lock for >30s could be interrupted. In practice, checkpoint operations complete in milliseconds.
- **No deadlock detection**: if two processes acquire locks in different orders, deadlock is possible. The current design only uses one lock per repo, so this is not a concern.
- **Polling is inefficient under contention**: high contention would spin-wait. The Pi use case has near-zero contention.

## Related

- `sdk/pi-checkpoint/src/lock.ts`
- `sdk/pi-checkpoint/src/repo-manager.ts`
