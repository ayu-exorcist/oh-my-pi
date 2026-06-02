# Trace Lab Extension Context

## Purpose

`@ayulab/pi-trace-lab` is a Pi extension for AI Engineering self-iteration: trace collection, structured session review, pattern clustering, and harness improvement drafting.

It turns Pi sessions into measurable experiments by:

1. Silently collecting tool sequences, file operations, and commands during each Turn;
2. Detecting anomalies in real time (error loops, high retry, scope creep, repeated reads);
3. Providing a TUI wizard for human-led session review after each session;
4. Clustering reviews into failure patterns on a weekly basis;
5. Generating harness iteration cards that require before/after verification.

## Public Behavior

- Registers `/trace-lab review` — structured TUI review of the latest session.
- Registers `/trace-lab weekly` — cluster reviews into patterns (last 7 days).
- Registers `/trace-lab draft <pattern-id>` — generate iteration card from a pattern.
- Registers `/trace-lab patterns` — list all patterns with status.
- Registers `/trace-lab status` — show current session stats and signals.
- Registers `/trace-lab verify <pattern-id>` — mark pattern as iterating.
- Registers `/trace-lab help` — show command reference.
- Automatically collects traces on `session_start`, `turn_start`, `tool_call`, `turn_end`, and `session_shutdown` events.
- Emits `ctx.ui.notify()` warnings when critical or warning signals are detected.

## Data Layout

All data lives under `~/.pi/agent/ayu/trace-lab/<project-key>/`:

```
~/.pi/agent/ayu/trace-lab/<project-key>/
├── sessions/    <session-id>.json     — Raw trace data
├── reviews/     <session-id>.md       — Human review outcomes
├── patterns/    patterns.json         — Clustered failure patterns
│                weekly-YYYY-WXX.md    — Weekly reports
└── iterations/  ITER-<pattern-id>.md  — Harness iteration cards
```

## Boundaries

Trace Lab does not own checkpointing, Write Mode, or mutating tool protection. Those live in `@ayulab/pi-rewind`, `@ayulab/pi-undo-redo`, `@ayulab/pi-checkpoint`, and `@ayulab/pi-write-gate`.

Trace Lab does not write outside its own data directory. All traces, reviews, patterns, and iterations stay project-local until explicitly promoted.

Trace Lab depends on `@ayulab/pi-trace-engine` for the core collector, analyzer, and storage engine. It adds Pi-specific event binding and TUI on top.

Trace Lab depends on `@ayulab/pi-checkpoint` for `SessionStateMap` to manage per-session collector instances.

## Key Terms

- **Trace**: A complete record of one Pi session, including all Turns, tool calls, and detected signals.
- **Turn**: A single user request-response cycle within a session.
- **Signal**: A detected anomaly during a Turn (error_loop, high_retry, scope_creep, repeated_read, verification_heuristic).
- **Review**: A human-assessed outcome of a session, including failure layer, harness improvement idea, and iterate decision.
- **Pattern**: A clustered group of reviews sharing the same failure layer and normalized iteration idea.
- **Iteration Card**: A markdown document proposing a harness change, requiring proposed change, expected improvement, and verification plan.

## Files

- `src/index.ts` — Extension entry, event wiring, command router.
- `src/types.ts` — Domain types (re-exported from `@ayulab/pi-trace-engine`).
- `src/storage.ts` — File-based persistence (re-exported from `@ayulab/pi-trace-engine`).
- `src/collector.ts` — TurnCollector + SessionCollector (re-exported from `@ayulab/pi-trace-engine`).
- `src/analyzer.ts` — Signal detection + session summary (re-exported from `@ayulab/pi-trace-engine`).
- `src/reviewer.ts` — Session review wizard orchestration.
- `src/patterns.ts` — Clustering + TUI confirmation.
- `src/drafter.ts` — Iteration card markdown generation.
- `src/ui/wizard.ts` — Reusable TUI select/text overlay components.

## Invariants

- Trace collection is fully automatic; human confirmation is required for promotion to patterns or iteration cards.
- Detection thresholds favor missing a signal over false alarms.
- Every pattern must have ≥2 source sessions.
- Iteration cards require before/after verification before being marked as verified.
- All data stays within the trace-lab directory.
- In non-interactive mode, commands return gracefully without blocking.

## Verification Focus

When changing this extension, test:

- event handler wiring (session_start, turn_start, tool_call, turn_end, session_shutdown);
- real-time signal detection and notification thresholds;
- `/trace-lab review` TUI flow and review persistence;
- `/trace-lab weekly` clustering logic and pattern confirmation;
- `/trace-lab draft` iteration card generation;
- `/trace-lab patterns` listing and status display;
- `/trace-lab status` session stats formatting;
- `/trace-lab verify` status transitions;
- data directory creation and file I/O error handling.
