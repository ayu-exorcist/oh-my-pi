---
name: benchmark-run
description: Run AI harness benchmark before/after and produce a benchmark run report. Use when evaluating changes to AGENTS.md, skills, hooks, templates, permissions, or CI gates.
---

# Benchmark Run

## When to use

- When evaluating changes to AGENTS.md, skills, hooks, templates, or permissions.
- When verifying whether a harness iteration is worth promoting.

## Steps

1. Read `benchmarks/ai-agent/suite.md` (or the project's benchmark suite).
2. Fix the model, task input, commands, and scoring rules.
3. Record the baseline (before change) or read the previous baseline.
4. Record the after (after change).
5. Fill out the benchmark-run-report.
6. Do not hide regression.
7. Give a promote / revert / keep-as-experiment recommendation.

## Key Requirements

- Same model, same harness, same task.
- Evolve set can be used repeatedly for debugging; held-out set is run only before promotion.
- For critical tasks use Pass^3 Lite: run the same task independently 3 times; all must pass to be considered reliable.
- Record failure mode mix (verification_skipped, hallucinated_completion, tool_misuse, repeated_error_loop, unsafe_mutation).
- Human/hybrid tasks must have a human rubric, or be explicitly marked `human_review=not_required`.

## Report Template

```text
## Benchmark Run Report

### Harness provenance
- AGENTS.md / skills / prompts version:

### Model/config

### Task

### Baseline vs After

### Regression

### Cost

### Recommendation
```
