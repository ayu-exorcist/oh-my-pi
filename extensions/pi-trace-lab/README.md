# @ayulab/pi-trace-lab

> Pi extension for AI Engineering self-iteration: trace collection, structured session review, and pattern clustering.

## What it does

**pi-trace-lab** turns your Pi sessions into measurable experiments. It collects tool sequences, file operations, and commands silently; detects anomalies in real time; and provides a structured workflow for turning failures into harness improvements.

### Core loop

```
Pi session → TraceCollector (auto) → Analyzer detects signals → Storage
                              ↓
                    /trace-lab review (TUI wizard)
                              ↓
                    SessionReview markdown
                              ↓
                    /trace-lab weekly (auto cluster)
                              ↓
                    Pattern → /trace-lab draft → Iteration Card
                              ↓
                    Verify with benchmark → mark verified
```

## Install

```bash
# From oh-my-pi workspace
pnpm install
```

Or as standalone Pi package (when published):

```bash
pi install npm:@ayulab/pi-trace-lab
```

## Data layout

All data lives under `~/.pi/agent/ayu/trace-lab/<project-key>/`:

```
~/.pi/agent/ayu/
├── checkpoints/sessions/           — pi-checkpoint bare repos
└── trace-lab/<project-key>/
    ├── sessions/          <session-id>.json     — Raw trace data
    ├── reviews/           <session-id>.md       — Human review outcomes
    ├── patterns/          patterns.json         — Clustered failure patterns
    │                      weekly-YYYY-WXX.md    — Weekly reports
    └── iterations/        ITER-<pattern-id>.md  — Harness iteration cards
```

## Commands

| Command                 | Purpose                                         | Machine or Human                         |
| ----------------------- | ----------------------------------------------- | ---------------------------------------- |
| `/trace-lab review`     | Structured TUI review of the latest session     | **Human** (decision)                     |
| `/trace-lab weekly`     | Cluster reviews into patterns, confirm with TUI | **Mixed** (auto cluster + human confirm) |
| `/trace-lab draft <id>` | Generate iteration card from a pattern          | **Machine** (draft)                      |
| `/trace-lab patterns`   | List all patterns with status                   | **Machine**                              |
| `/trace-lab status`     | Show current session stats and signals          | **Machine**                              |
| `/trace-lab help`       | Show command reference                          | —                                        |

## Automatic signals

The extension detects these signals during each Turn:

| Signal                   | Trigger                                                    | Severity           |
| ------------------------ | ---------------------------------------------------------- | ------------------ |
| `error_loop`             | Same command executed ≥2 times in one Turn                 | warning / critical |
| `high_retry`             | >30 tool calls in one Turn                                 | warning / critical |
| `scope_creep`            | ≥5 distinct files modified in one Turn                     | warning / critical |
| `repeated_read`          | Same file read ≥3 times in one Turn                        | info               |
| `verification_heuristic` | Verification ran early but not re-checked after many tools | info               |

When warning/critical signals fire, you get a `ctx.ui.notify()` nudge to review the session.

## Review TUI

After a session (or anytime via `/trace-lab review`), the extension walks you through:

1. **Outcome** — success / partial / failure
2. **Failure layer** — environment_contract / procedural_skill / action_realization / trajectory_regulation / observation
3. **Harness improvement** — "If X was written, this wouldn't happen"
4. **Should iterate** — yes / no
5. **Iteration idea** — Brief description for pattern naming
6. **Notes** — Freeform

Each step is a dedicated `ctx.ui.custom()` overlay with keyboard navigation (↑↓ Enter Esc).

## Weekly pattern clustering

`/trace-lab weekly` analyzes the last 7 days of reviews:

1. Groups reviews by `(failure_layer, normalized_iteration_idea)`
2. Only surfaces groups with ≥2 occurrences
3. Merges with existing patterns (fuzzy match on description)
4. Presents new patterns in TUI for you to confirm/edit/skip
5. Saves confirmed patterns as `status: drafting`

## Iteration card

`/trace-lab draft <pattern-id>` generates a markdown card with:

- Problem description
- Evidence (frequency, reviewer quotes, avg metrics)
- **Proposed Change** — _you fill this in_
- **Expected Improvement** — _you fill this in_
- **Verification Plan** — _you fill this in_

The card stays in `~/.pi/agent/ayu/trace-lab/<project-key>/iterations/` until you verify it with real before/after data.

## Design principles

1. **Machine collects, human decides** — Trace collection is fully automatic. Promotion to patterns, iteration cards, and knowledge base requires human confirmation.
2. **Conservative signals** — Detection thresholds favor missing a signal over false alarms, to prevent notification fatigue.
3. **Evidence-first** — Every pattern must have ≥2 source sessions. Iteration cards require before/after verification.
4. **No automatic writes outside project scope** — All data stays within the trace-lab directory. Patterns remain project-local until explicitly promoted.

## Architecture

```
src/
├── index.ts          — Extension entry, event wiring, command router
├── types.ts          — All domain types
├── storage.ts        — File-based persistence (JSON + Markdown)
├── collector.ts      — TurnCollector + SessionCollector
├── analyzer.ts       — Signal detection + session summary
├── reviewer.ts       — Session review wizard orchestration
├── patterns.ts       — Clustering + TUI confirmation
├── drafter.ts        — Iteration card markdown generation
└── ui/
    └── wizard.ts     — Reusable TUI select/text overlay components
```

## Changelog

### 2026-06-02

- Removed `/trace-lab sync` command and `ai-engineering` dependency.
- All trace-lab data now stored under `~/.pi/agent/ayu/trace-lab/<project-key>/`.

## License

GPL-3.0
