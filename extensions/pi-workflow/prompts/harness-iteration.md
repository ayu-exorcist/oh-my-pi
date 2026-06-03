---
description: Draft a harness iteration card from a recent failure or review
argument-hint: "[failure-context]"
---

Based on the recent failure, review返工, or benchmark regression, draft a harness iteration card.

Context: $ARGUMENTS

Output exactly these sections:

## Trigger

- [ ] Real task failure / Weekly review / Benchmark regression / Review 返工 / Cost anomaly

## Evidence

- Task/PR/session link:
- Failure fact (observable only, no guess):
- Impact (rework, error, cost, risk):

## Failure Classification

- [ ] Environment contract — AGENTS/docs/task description unclear
- [ ] Procedural skill — missing SOP/workflow/template
- [ ] Action realization — command, schema, CI, hook, format check insufficient
- [ ] Trajectory regulation — loop, repeated failure, scope creep, missing human escalation
- [ ] Observation — missing trace, metric, report

## Proposed Change

- Modify location:
- Minimal change:
- Edit type: bounded add / delete / replace / full rewrite (explain if full)
- Non-goals (what this change explicitly does NOT do):

## Expected Improvement

| Metric                          | Baseline | Expected Change |
| ------------------------------- | -------- | --------------- |
| Solve rate                      |          |                 |
| One-shot verification pass rate |          |                 |
| Human interventions per task    |          |                 |
| Review rework rounds            |          |                 |
| Token/time/cost                 |          |                 |

## Benchmark Plan

- Suite:
- Evolve tasks:
- Held-out tasks:
- Fixed model/version:
- Fixed command:

## Promote / Revert Criteria

- [ ] Held-out solve rate does not decrease
- [ ] Target metric improves by ≥ threshold
- [ ] No security/test weakening/API breakage regression
- [ ] Benchmark run report exists with trace summary

Do not modify any files. Produce the card text only.
