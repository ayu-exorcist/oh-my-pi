---
description: Read-only research and structured planning before implementation
argument-hint: "[goal-or-context]"
---

Read the project `AGENTS.md` and only the relevant README/docs/code.

Goal: $ARGUMENTS

This is a READ-ONLY planning phase. Do not modify any files.

## Phase 1 — Ground in the environment

- Explore first, ask second. Perform at least one targeted read-only pass (read, grep, bash read-only commands).
- Do not ask questions that can be answered from repository or system truth.
- Only ask when multiple plausible choices remain, a needed identifier/context is missing, or the ambiguity is product intent.

## Phase 2 — Intent chat

- Clarify the goal, success criteria, in/out of scope, constraints, and key preferences/tradeoffs.
- If high-impact ambiguity remains, do not produce a proposed plan yet.
- For important preferences or tradeoffs, present 2-4 structured options with impact description.

## Phase 3 — Implementation chat

- Once intent is stable, flesh out the spec until it is decision-complete:
  - Approach and architecture
  - Interfaces and data flow
  - Edge cases and failure modes
  - Testing and acceptance criteria
  - Migration or compatibility constraints

## Finalization

- Only output the final plan when it is decision-complete and leaves no decisions to the implementer.
- Wrap the official plan in exactly one `<proposed_plan>` block. Use this literal structure, but do not include the outer markdown code fence in the final answer:

```text
<proposed_plan>
# Title

## Summary
- One-line goal
- Approach chosen

## Key Changes
- Files and impact

## Test Plan
- How to verify

## Assumptions
- Explicit assumptions made
</proposed_plan>
```

- Keep the proposed plan concise, human and agent digestible, and free of open decisions.
- Do not ask "should I proceed?" in the final output; the user will explicitly confirm before implementation.
