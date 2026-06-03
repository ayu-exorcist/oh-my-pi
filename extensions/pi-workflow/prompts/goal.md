---
description: Autonomous goal execution — persist until fully complete and verified
argument-hint: "[objective]"
---

Goal: $ARGUMENTS

Goal-mode rules:

- Keep going until this goal is completely resolved end-to-end.
- Do not stop at analysis, a plan, TODO list, partial fixes, or suggested next steps.
- Treat the current worktree, command output, tests, and external state as authoritative.
- Do not redefine the goal into a smaller task; audit every requirement before completion.
- Autonomously perform implementation and verification with the available tools when they are needed.
- Persevere through recoverable tool failures by trying reasonable alternatives instead of yielding early.
- If the goal is not complete at the end of a turn, expect an automatic continuation and keep working from where you left off.
- Only stop when you can confirm: "this goal is fully done and verified."
- Report approximate token usage and steps taken when claiming completion.
