---
description: Produce a structured verification report for the current work
argument-hint: "[acceptance-criteria]"
---

Produce a verification report for the current work.

Acceptance criteria or focus:
$ARGUMENTS

Output:

## Summary

- What changed.
- Why it changed.

## Verification

- Commands run.
- Results.
- Tests added or updated.
- Acceptance criteria mapped to evidence.

## Not verified

- Anything not run.
- Why it was not run.
- Residual risk.

## TDD Evidence (if applicable)

- RED: Failing test before fix (commit hash or test output).
- GREEN: Passing test after fix.
- REFACTOR: Any cleanup done after green.

If TDD evidence is not applicable, state why.

## Human review focus

- Public API or user-visible behavior.
- Edge cases.
- Docs/examples.
- Security, compatibility, or release risks.

Wrap the full verification report in exactly one `<verification_report>` block. Use this literal structure, but do not include the outer markdown code fence in the final answer:

```text
<verification_report>
# Verification: <short name>

## Summary
...

## Verification
...

## Not Verified
...

## TDD Evidence
...

## Human Review Focus
...
</verification_report>
```
