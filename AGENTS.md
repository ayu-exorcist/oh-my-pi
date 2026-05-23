# Agent Instructions

Behavioral guidelines to reduce common LLM coding mistakes. Bias toward caution over speed.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask rather than guess.
- Present multiple interpretations — don't pick silently when ambiguity exists.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan with verification checkpoints.

## 5. Docs Stay in Sync

**When code changes, comments, docs, and config must change with it.**

- Update inline comments that describe behavior you've modified.
- Update README, CONTRIBUTING, or other project docs when interfaces or workflows change.
- Update configuration examples, schemas, and type definitions to match the new reality.
- Don't leave stale documentation behind.

## 6. Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles mapped to local-markdown status strings. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context monorepo with per-package `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
