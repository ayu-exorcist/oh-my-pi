---
description: Structured bug diagnosis and fix workflow
---

Run the bug diagnosis shape before proposing or applying any fix:

1. **Reproduce** — confirm the bug exists and capture exact error/output.
2. **Minimise** — find the smallest scope that triggers it (file, function, input).
3. **Hypothesise** — list possible causes ranked by likelihood.
4. **Failing test/repro** — write or point to a test that fails because of the bug.
5. **Fix** — apply the smallest change that makes the failing test pass.
6. **Regression verification** — run the test suite / check command to ensure no new failures.

Rules:

- Do not fix before reproducing.
- Do not change unrelated files.
- Every hypothesis must be testable.
- Report exact commands and outcomes for each step.
