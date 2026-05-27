---
description: Check whether current changes require README/docs/CHANGELOG updates
argument-hint: "[scope]"
---

Compare the current changes against README, docs, examples, and CHANGELOG expectations. Scope: $ARGUMENTS

Do not modify files first. Output:

1. User-visible behavior changes.
2. Public API/CLI/config changes.
3. README or example drift.
4. Architecture/testing docs that need updates.
5. CHANGELOG need: yes/no and why.
6. Minimal documentation patch plan.

If I confirm, update only necessary documentation. Avoid rewriting unrelated docs.
