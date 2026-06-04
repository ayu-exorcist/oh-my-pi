# Session Journal

> Purpose: Record context, decisions, and open items from AI sessions.
> Principle: Keep only information that affects future decisions. Do not record full chat history.

## Active Task

- **Task**: <title>
- **Status**: todo / doing / review / done
- **Blocked by**: <if any>

## Decisions Made

- <Decision 1: a choice you will not revisit>
- <Decision 2: a discarded option and why>

## Key Changes

| File     | Summary        |
| -------- | -------------- |
| `<path>` | <one sentence> |

## Open Todos

- [ ] <for next session>

---

## YYYY-MM-DD Session

### Decisions

- <decision description>

### Key Changes

| File     | Summary        |
| -------- | -------------- |
| `<path>` | <one sentence> |

### Open Todos

- [ ] <todo item>

---

## 2026-06-04 Session

### Decisions

- Explicit concrete operations with safe defaults should not be blocked by clarification.
- Missing details should only trigger clarification when they change the outcome or no safe default exists.

### Key Changes

| File                        | Summary                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                 | Added a shorter rule that concrete operations with safe defaults should execute without clarification. |
| `.pi/ayu/tasks/ai-notes.md` | Recorded the failure hypothesis and verification plan for the rule change.                             |

### Open Todos

- [ ] Define a held-out benchmark or prompt suite for this clarification rule so future harness changes can be evaluated consistently.

---

## 2026-06-03 Session

### Decisions

- `/ayu review` uses a 0–5 scale where 5 means perfect/no meaningful follow-up needed.
- P2-5 structured output blocks are kept prompt-only and do not add external workflow packages.

### Key Changes

| File                                            | Summary                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `extensions/pi-workflow/prompts/review-diff.md` | Changed review scoring from 0–4 to 0–5 and wrapped review output in one `<review_report>` block. |
| `extensions/pi-workflow/prompts/task.md`        | Wrapped task planning output in one `<task_card>` block.                                         |

### Verification / Cleanup

- `pnpm install` completed; workspace reported already up to date.
- `pnpm run check` passed typecheck, lint, and format after formatting the changed prompt/journal files, then failed in root `vitest` due to timeouts in `@ayulab/pi-rewind` and `@ayulab/pi-checkpoint` tests.
- User selected: delete untracked `tasks/`, keep `extensions/pi-clarify/*` changes.
- Final diff review found and fixed stale `pi-write-gate` references in context/config docs, malformed prompt output block examples caused by markdown formatting, and `pi-clarify` disabled-option/cancel edge cases.
- `extensions/pi-workflow`: `pnpm run typecheck && pnpm run test` passed with 11 tests.
- `extensions/pi-clarify`: `pnpm --filter @ayulab/pi-clarify test` passed; later coverage-focused tests increased it to 57 tests after the commit hook failed on coverage thresholds.
- Root typecheck/lint/format passed via `pnpm run typecheck && pnpm run lint && pnpm run fmt:check`.

### Open Todos

- [x] Manually remove the orphaned `extensions/pi-write-gate` directory; user completed this manually and `PI_WRITE_GATE_DIR_EXISTS=0` was confirmed.
- [x] Remove untracked `tasks/` trace-lab session artifact.
- [ ] Investigate unrelated root test timeouts in `@ayulab/pi-rewind` and `@ayulab/pi-checkpoint` if root `pnpm run check` must pass.

- 2026-06-03: Vendored pi-permission-system as @ayulab/pi-permission-system, started Ayu path migration. Package tests currently paused after two failures: alias fixed, remaining failures are mostly Windows/POSIX path assertions plus a few Ayu path expectations.

- 2026-06-03: Completed local @ayulab/pi-permission-system vendoring and Ayu path migration. Verified package typecheck/test/build plus root fmt/typecheck/lint/test.

## 2026-06-04 Session

### Decisions

- Rewind checkpoint prompt attribution should use `before_agent_start.event.prompt` when available, not only branch backtracking.
- `/rewind` should flush a pending checkpoint at `turn_end` and keep `agent_end` only as a fallback, to avoid checkpoint append lag across consecutive prompts.

### Key Changes

| File                                     | Summary                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `extensions/pi-rewind/src/index.ts`      | Captures prompt at `before_agent_start`, flushes checkpoints at `turn_end`, and prevents duplicate finalization. |
| `extensions/pi-rewind/src/index.test.ts` | Added regression coverage for prompt/branch drift and turn-end flush timing.                                     |

### Verification

- `pnpm exec vitest run extensions/pi-rewind/src/index.test.ts`
- `pnpm exec vitest run extensions/pi-rewind/src/auto-checkpoint.test.ts extensions/pi-rewind/src/commands/rewind.test.ts`

### Open Todos

- [ ] Consider whether `/rewind` should also surface the captured turn prompt in the UI for easier diagnosis.
- [ ] Investigate queued-turn checkpoint lag under rapid follow-up prompts: added session-level serialization and turn-id de-duplication to prevent duplicate or shifted `/rewind` entries.
