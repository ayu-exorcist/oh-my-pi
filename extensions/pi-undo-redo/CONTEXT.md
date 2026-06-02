# UndoRedo Extension

Pi extension that provides `/undo` and `/redo` commands for stepping backward and forward through the session's Checkpoint history. Does not create Checkpoints; consumes entries written by Rewind (or any other checkpoint-aware extension).

## Language

**Undo**:
The `/undo` command that reverts the workspace and conversation to the `beforeCommit` of the most recent Checkpoint. Pushes the pre-undo state onto the Redo Stack so the action can be reversed.
_Avoid_: revert, rollback, backstep

**Redo**:
The `/redo` command that reverses a prior Undo by checking out the Checkpoint's `afterCommit` and navigating back to the conversation leaf that was active before the Undo. Redo is not "re-executing" the original agent work; it is restoring the state that existed before the Undo.
_Avoid_: replay, re-execute, repeat

**Redo Entry**:
A record pushed onto the Redo Stack during an Undo, containing:

- `targetLeafId` — the conversation leaf ID that was active before the Undo
- `afterCommit` — the `afterCommit` hash of the Checkpoint being undone
  _Avoid_: redo state, redo target, undo record

**Redo Stack**:
A per-session, in-memory stack of Redo Entries. Volatile — lost when the session restarts or the extension shuts down. Each session has its own isolated stack.
_Avoid_: history buffer, undo log, state cache

**Checkpoint Consumer**:
The role of UndoRedo as an extension that reads `CheckpointEntry` custom entries from the session history but never writes them. This distinguishes it from Rewind, which is a Checkpoint Producer.
_Avoid_: checkpoint reader, checkpoint client

## Flagged ambiguities

- **Redo is not "re-executing"**: When a user Redos an Undo, the extension does not re-run the original agent Turn. It simply checks out the `afterCommit` that was saved in the Redo Entry and navigates the conversation tree back to the previous leaf. The agent's original work is already captured in git; Redo just restores it.
- **Undo is not Rewind**: `/undo` always targets the most recent Checkpoint. `/rewind` (provided by Rewind Extension) lets the user pick any historical Checkpoint from a list. Undo is a quick step-back; Rewind is interactive exploration.
- **Redo Stack is in-memory only**: There is no persistence. If Pi crashes or the user starts a new session, the Redo Stack is empty and `/redo` reports "Nothing to redo."
- **UndoRedo is a Checkpoint Consumer, not Producer**: This extension does not register `turn_start`/`turn_end` hooks. It relies on another extension (typically Rewind) to populate the session with `CheckpointEntry` custom entries. If no Checkpoints exist, both `/undo` and `/redo` are no-ops.

## Example dialogue

> **Dev**: I'm seeing a bug where `/redo` after `/undo` doesn't restore the conversation to the right place. What should I check?
>
> **Domain expert**: Look at the Redo Entry that was pushed during the Undo. The `targetLeafId` must be the leaf ID that was active _before_ the Undo ran — that is, the leaf corresponding to the `afterCommit` being undone. The Redo handler checks out `afterCommit` and then calls `navigateTree(targetLeafId)`. If `targetLeafId` was captured incorrectly (for example, from a stale session state), the conversation will jump to the wrong place.
>
> **Dev**: Should the Redo Stack be persisted across sessions?
>
> **Domain expert**: No — the Redo Stack is intentionally volatile. It lives only in memory and is cleared on `session_shutdown`. Persisting it would introduce complexity around session boundaries, fork semantics, and stale references. The design assumption is that Undo/Redo is a session-local, short-term navigation aid, not a durable history.
>
> **Dev**: What happens if I install UndoRedo but not Rewind?
>
> **Domain expert**: UndoRedo is a Checkpoint Consumer. It reads `CheckpointEntry` entries from the session history. If no extension is producing those entries, `/undo` and `/redo` will both report "Nothing to undo." / "Nothing to redo." You need a Checkpoint Producer like Rewind (or a custom extension that writes `pi-checkpoint` custom entries) for UndoRedo to function.
