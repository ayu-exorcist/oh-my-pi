# Trace Engine Context

## Purpose

`@ayulab/pi-trace-engine` is an AI Engineering trace collection, analysis, and storage engine with zero Pi runtime dependencies. It can be used in any Node.js project.

It provides:

1. **Collection** — `TurnCollector` and `SessionCollector` for real-time trace accumulation;
2. **Analysis** — Signal detection (error loops, scope creep, high retry, repeated reads, verification heuristic);
3. **Storage** — `StorageManager` for file-based persistence of traces, reviews, and patterns.

## Public Behavior

- `TurnCollector` accumulates tool calls, file operations, and commands for a single Turn.
- `SessionCollector` manages multiple Turns and produces a finalized session trace.
- `analyzeTurn()` detects failure signals from a completed Turn.
- `buildSessionSummary()` aggregates signals across all Turns into session-level stats.
- `formatSessionStats()` produces human-readable session statistics.
- `StorageManager` handles JSON and Markdown persistence under a configurable base directory.

## Language

**Trace**:
A complete record of one Pi session, containing all Turns, tool calls, file operations, and detected failure signals.
_Avoid_: log, telemetry, session record

**Turn**:
A single user request-response cycle within a session. Each Turn produces one `TurnTrace` after finalization.
_Avoid_: step, round, iteration

**Signal**:
A detected anomaly during a Turn, classified by severity (info, warning, critical).
_Avoid_: alert, error, flag

**Failure Layer**:
The taxonomy layer where a failure originated: environment*contract, procedural_skill, action_realization, trajectory_regulation, or observation.
\_Avoid*: category, type, level

**Pattern**:
A clustered group of reviews sharing the same failure layer and normalized iteration idea, requiring ≥2 source sessions.
_Avoid_: template, archetype, cluster

**Iteration Card**:
A markdown document proposing a harness change with problem description, evidence, proposed change, expected improvement, and verification plan.
_Avoid_: ticket, issue, task

## Flagged Ambiguities

- **"Trace" vs "SessionTrace"**: In casual discussion, "trace" refers to the entire session record. The precise type is `SessionTrace` (all Turns) or `TurnTrace` (single Turn).
- **Signal severity is heuristic**: Thresholds (e.g., >30 tool calls for high_retry) are tuned for conservative detection. Adjusting them changes the signal-to-noise ratio.
- **StorageManager is filesystem-only**: There is no in-memory or database backend. All persistence uses `node:fs/promises`.

## Example Dialogue

> **Dev**: I'm adding a new signal type for long-running bash commands. Where should I add it?
>
> **Domain expert**: Add the signal definition to `src/types.ts`, then implement the detection logic in `src/analyzer.ts` within `analyzeTurn()`. Make sure to include a test in `src/analyzer.test.ts` that covers both the trigger condition and the severity level.
>
> **Dev**: Should I also update the Trace Lab extension?
>
> **Domain expert**: Only if the signal should trigger a real-time notification. The core engine change is sufficient for data collection. Trace Lab (`extensions/pi-trace-lab/src/index.ts`) handles notifications by checking `turn.failureSignals` in `onTurnEnd()`.

## Files

- `src/index.ts` — Public API exports.
- `src/types.ts` — Core type definitions for trace, review, pattern, and iteration.
- `src/collector.ts` — `TurnCollector` + `SessionCollector` — real-time trace accumulation.
- `src/analyzer.ts` — `analyzeTurn()`, `buildSessionSummary()`, `formatSessionStats()`.
- `src/storage.ts` — `StorageManager` — file-based persistence.

## Invariants

- `TurnCollector` must be finalized before analysis; unfinalized Turns have undefined behavior.
- `SessionCollector` produces immutable `SessionTrace` on finalize.
- Signal detection thresholds favor false negatives over false positives.
- `StorageManager` creates directories lazily on first write.
- All file I/O errors are propagated to the caller; the engine does not swallow exceptions.

## Verification Focus

When changing this engine, test:

- `TurnCollector` initialization and tool call recording;
- `SessionCollector` multi-turn management and finalization;
- signal detection for all types (error_loop, high_retry, scope_creep, repeated_read, verification_heuristic);
- severity escalation (warning → critical) thresholds;
- `buildSessionSummary()` aggregation accuracy;
- `formatSessionStats()` output format;
- `StorageManager` CRUD operations for traces, reviews, and patterns;
- type guard functions (`isReviewOutcome`, `isFailureLayer`, `isPattern`, etc.);
- filesystem error handling (missing files, permission errors).
