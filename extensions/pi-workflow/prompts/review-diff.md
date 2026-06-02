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

Output:

## Blocking issues

## Non-blocking suggestions

## Verification gaps

## Human review focus
