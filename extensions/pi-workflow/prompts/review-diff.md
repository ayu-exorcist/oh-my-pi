---
description: Review current git diff for correctness, scope, tests, docs, and risk
argument-hint: "[focus]"
---

Review the current git diff. Focus: $ARGUMENTS

Use project rules from `AGENTS.md` if present. Do not modify files.

Check:

- Does the diff satisfy the task goal?
- Are there unrelated changes, formatting churn, or speculative abstractions?
- Could this break public API, behavior, compatibility, or security?
- Are tests sufficient and meaningful?
- Were tests weakened, deleted, over-mocked, or made less strict?
- Do README/docs/CHANGELOG need updates?
- Are dependencies, scripts, or release behavior changed?

## Scoring (0–5)

| Score | Meaning                                            |
| ----: | -------------------------------------------------- |
|     0 | Unacceptable — direction wrong or major risk       |
|     1 | Relevant but needs significant rework              |
|     2 | Basically usable, needs visible changes            |
|     3 | Acceptable, only minor issues                      |
|     4 | High quality, can adopt directly                   |
|     5 | Perfect — no meaningful issues or follow-up needed |

Rate both phases separately.

Output the full review in exactly one `<review_report>` block. Use this literal structure, but do not include the outer markdown code fence in the final answer:

```text
<review_report>
# Review: <short name>

## Spec Compliance Score: N/5
- Does the diff satisfy the task goal and acceptance criteria?
- Are non-goals respected?
- Are constraints followed?
- Is there scope creep?

## Code Quality Score: N/5
- Does the diff follow project style and conventions?
- Are there unrelated changes, formatting churn, or speculative abstractions?
- Could this break public API, behavior, compatibility, or security?
- Are tests sufficient and meaningful?
- Were tests weakened, deleted, over-mocked, or made less strict?
- Do README/docs/CHANGELOG need updates?
- Are dependencies, scripts, or release behavior changed?

## Blocking Issues

## Non-blocking Suggestions

## Verification Gaps

## Human Review Focus
</review_report>
```
