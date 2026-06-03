---
description: Start an AI engineering task from a task card; plan first, then wait
argument-hint: "[task-card-or-goal]"
---

Read the project `AGENTS.md` and only the relevant README/docs/code for this task.

Task input:
$ARGUMENTS

Before editing anything, output:

1. Task type and risk level.
2. Your understanding of the goal.
3. Up to 3 blocking clarification questions, if any.
4. Non-goals and scope boundaries.
5. Smallest implementation plan, 3-7 steps.
6. Files likely to change.
7. Verification plan.
8. Any special workflow or extra context needed before implementation.

Do not modify files until I confirm the plan and explicitly authorize implementation.

If the task is complex (involves multiple files, architectural changes, or significant refactoring), suggest using `/ayu plan $ARGUMENTS` instead for a structured read-only research phase before implementation.

## Execution tracking

- When implementing, maintain the task card and mark each step as complete:
  - `[x] <step>` for completed
  - `[ ] <step>` for pending
  - `[-] <step>` for blocked by another step
- If a step reveals new work, add it to the task card rather than silently expanding scope.
- If a step is blocked by an external dependency or another task, explicitly state the blocker.
- After completing the primary goal, check if any follow-up tasks were discovered and list them.

## Structured output hint

When presenting the plan, wrap the lightweight task card in exactly one `<task_card>` block the user can confirm. Use this literal structure, but do not include the outer markdown code fence in the final answer:

```text
<task_card>
# Task: <short name>

## Goal
<one-line goal>

## Non-goals
- <out-of-scope item>

## Steps
1. [ ] <step>
2. [ ] <step>
...

## Dependencies
- Step N depends on Step M (explain why)

## Files
- <file> — <impact>

## Verification
- <command or check>
</task_card>
```
