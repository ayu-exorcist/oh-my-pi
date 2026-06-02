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

If the task is complex (involves multiple files, architectural changes, or significant refactoring), suggest using `/plan $ARGUMENTS` instead for a structured read-only research phase before implementation.
