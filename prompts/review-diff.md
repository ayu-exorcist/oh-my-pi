---
description: Review a code or documentation diff before merge
---

Review the proposed changes against these dimensions:

1. **Correctness** — does the change do what it claims? Any logic errors?
2. **Scope control** — are there unrelated refactors, formatting changes, or dependency bumps?
3. **Tests** — are new behaviors covered by tests? Do existing tests still pass?
4. **Safety** — any secret exposure, unsafe mutation, or T3/T4 side effects?
5. **Documentation** — are README/AGENTS.md/CONTEXT.md updates included if behavior changed?
6. **Compatibility** — any breaking changes to public API, config, or command interface?

Output:

- approve / request_changes / reject
- One-line summary
- Specific line-level notes (if applicable)
- Suggested fix for each issue found
