---
description: Run a frozen AI agent benchmark suite and produce a scored report
---

Run the benchmark suite with these constraints:

1. Use the **fixed model, fixed tools, fixed settings** defined in the suite spec.
2. For each task:
   - Restore to the exact starting state.
   - Run the task prompt.
   - Execute the required verification command.
   - Record pass/fail, tool sequence, failure mode, and cost.
3. Scoring:
   - Automated tasks: run verification command, record result.
   - Hybrid tasks: automated verification first, then queue for human scoring.
   - Human tasks: generate evidence package and scoring rubric, mark `pending_human_score`.
4. Pass^3 Lite: for high-risk held-out tasks, run 3 independent trials; all must pass.
5. Output a benchmark-run-report.md with:
   - Suite metadata (model, tools, settings hash)
   - Per-task results
   - Aggregate metrics (solve rate, regression count, cost)
   - Failure mode breakdown
   - Promote / revert / keep recommendation

Do not change model, routing policy, cache mode, toolset, or task set mid-run.
