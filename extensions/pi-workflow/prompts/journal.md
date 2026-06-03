---
description: Update the session journal with a concise summary of the current session
---

Based on the full session trajectory, update the session journal at `~/.pi/agent/ayu/workspace/journal.md`. Only record:

1. **Completed decisions** — decisions that will not be revisited.
2. **In-progress tasks** — current task and progress percentage.
3. **Blockers / open questions** — anything waiting for human input or external dependency.
4. **Key code changes** — files changed + one-line summary per change.
5. **Todos for next session** — concrete next steps.

If the journal file does not exist, create it with the header `# Session Journal`.

Do NOT record full chat history. Keep it scannable (≤50 lines).
