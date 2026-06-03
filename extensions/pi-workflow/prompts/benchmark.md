---
description: Run a benchmark evaluation and produce a run report
argument-hint: "[suite-path-or-scope]"
---

Run a benchmark evaluation for the current harness change.

Scope: $ARGUMENTS

Requirements:

1. **Fixed inputs**: Use the same model, tool versions, and task inputs as the baseline.
2. **Baseline**: Read or record the baseline metrics before the change.
3. **After**: Record metrics after the change.
4. **Evolve set**: Run the tasks used to design/debug the change.
5. **Held-out set**: Run the frozen tasks reserved for final validation.
6. **Report**: Fill out the following template.

## Benchmark Run Report

### Harness Version

- AGENTS/docs/templates/skill commit or file version:

### Model/Config

- Provider, model, snapshot:
- Tool permissions, sandbox mode:

### Tasks

| Task ID | Type | Result | Notes |
| ------- | ---- | ------ | ----- |

### Verification

- Commands run:
- Test/lint/typecheck/build results:

### Failure Modes

| Failure Mode            | Count | Before | After |
| ----------------------- | ----- | ------ | ----- |
| verification_skipped    |       |        |       |
| hallucinated_completion |       |        |       |
| tool_misuse             |       |        |       |
| repeated_error_loop     |       |        |       |
| unsafe_mutation         |       |        |       |

### Cost

- Token / API cost:
- Human interventions:
- Time elapsed:

### Conclusion

- Promote / Revert / Keep as experiment:
- Reason:
- Residual risk:

Do not modify files unless the benchmark itself requires a test/fixture change.
