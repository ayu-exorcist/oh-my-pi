---
name: verify-change
description: Run expected checks after code changes and produce a verification report. Use after implementing any code change to ensure quality before claiming completion.
---

# Verify Change

## When to use

- After every code change, before claiming task completion.
- When the user asks to verify or check current changes.

## Steps

1. Determine the verification commands the project should run (from AGENTS.md, package.json, Makefile, CI config).
2. Run the minimal relevant verification (do not run the full test suite if the change is small).
3. Record commands and output summary.
4. If verification fails, fix first then report completion; do not skip.
5. Generate a verification report.

## Verification Report Template

```text
## Change Summary
- Files changed:
- Purpose:

## Verification Commands and Results
| Command | Result | Notes |
|---|---|---|
| | | |

## Risks and Follow-up Suggestions
```

## Failure modes

- `verification_skipped`: Claimed completion but did not run verification → must re-run.
- `hallucinated_completion`: Claimed tests passed but they were not run or results did not match → re-run and record output.
