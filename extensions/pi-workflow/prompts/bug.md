---
description: Structured bug diagnosis and fix workflow
argument-hint: "[bug-description]"
---

Bug: $ARGUMENTS

Follow the Ayu bug diagnosis shape strictly:

1. **Reproduce**: Create a minimal reproduction test or script.
2. **Minimize**: Strip the reproduction to the smallest possible case.
3. **Hypothesize**: State your hypothesis about the root cause.
4. **Failing test**: Write a test that fails before the fix.
5. **Fix**: Apply the minimal fix.
6. **Regression verification**: Run the test + existing tests to confirm no breakage.

Do not skip steps. Do not modify files until the failing test is written and confirmed failing.

Output progress after each step. When summarizing the full bug report, wrap it in exactly one `<bug_report>` block. Use this literal structure, but do not include the outer markdown code fence in the final answer:

```text
<bug_report>
# Bug: <short name>

## Reproduce
- Steps or script

## Minimize
- Smallest case

## Hypothesis
- Root cause guess

## Failing Test
- Test that fails before fix

## Fix
- What was changed

## Regression Verification
- Tests run and results
</bug_report>
```
