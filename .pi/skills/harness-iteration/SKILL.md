---
name: harness-iteration
description: Evaluate whether to add or modify AI rules, templates, or skills based on a real failure. Use when AI makes repeated mistakes or when considering changes to AGENTS.md, skills, or prompts.
---

# Harness Iteration

## Core Rule

Do not append long-term rules from a single failure. Follow the promotion ladder:

```text
recorded → understood → practiced → passed → generalized → promoted
```

Only when reaching `promoted` may a rule enter `AGENTS.md` / skill / prompt.

## Steps

1. Collect failure facts (no guessing).
2. Categorize by harness layer: environment contract / process skill / action implementation / trajectory control / observation.
3. Write an iteration card.
4. Make the minimal change (one skill / one prompt / one checklist).
5. Run before/after benchmark (evolve set and held-out set).
6. Promote if targets are met; revert or mark as rejected if not.

## Iteration Card Minimum Format

```text
## Failure facts
## Harness layer
## Change hypothesis
## Expected improvement metrics
## Possible regression
## Promote/revert criteria
```

## Guard: Rule Bloat Check

Before adding a new rule, answer:

1. Is it from a real failure?
2. Is it frequent and general?
3. Can it be turned into a test/CI/lint/schema?
4. Should it stay in an on-demand workflow rather than AGENTS.md?
5. What benchmark proves it works?

## Anti-patterns

- Writing a single lesson directly into AGENTS.md.
- Claiming "it's better" based on feeling alone.
- Claiming harness improvement after swapping to a more expensive model.
- Auto-generating a skill/prompt and enabling it without held-out validation.
