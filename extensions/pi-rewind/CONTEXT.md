# Rewind Extension

Pi extension that automatically captures a Checkpoint for every Turn and provides the `/rewind` command for interactive checkpoint navigation.

## Language

**Auto Checkpoint**:
The automatic creation of a Checkpoint at each Turn's boundaries (`turn_start` and `turn_end`). Controlled by `CheckpointConfig.autoCheckpoint`. Requires no user intervention.
_Avoid_: implicit checkpoint, automatic save, per-turn snapshot

**Rewind**:
The `/rewind` command that presents an interactive Checkpoint List and restores the workspace and/or conversation to a selected historical Turn.
_Avoid_: rollback, revert, go back, restore

**Checkpoint List**:
The interactive selection UI presented by `/rewind`, showing historical Checkpoints with their Prompt Preview and File Change Stats.
_Avoid_: history, timeline, snapshot list

**Restore Mode**:
The four options presented after selecting a Checkpoint in `/rewind`:

1. **Restore code and conversation** — checkout `beforeCommit` and navigate to the Turn's conversation entry.
2. **Restore conversation only** — navigate to the Turn's conversation entry without checking out files. Bypasses dirty guard because no filesystem changes occur.
3. **Restore code** — checkout `beforeCommit` without changing the conversation position.
4. **Summarize from here** — navigate to the Turn with `summarize: true`, optionally accepting custom summary instructions. Does not modify files.
   _Avoid_: restore option, recovery mode, action

**Prompt Preview**:
The truncated user prompt (up to 60 characters) displayed in the Checkpoint List to help identify which Turn produced each Checkpoint.
_Avoid_: prompt summary, message label, turn title

**File Change Stats**:
The per-file addition and removal counts (`+added -removed`) shown in the Checkpoint List for each Checkpoint. Derived from `CheckpointEntry.fileChanges`.
_Avoid_: diff stats, change metrics, file metrics

## Flagged ambiguities

- **"Restore conversation only" bypasses dirty guard**: This is deliberate. Because no filesystem checkout occurs, there is no risk of overwriting unsaved work. The user's working tree remains untouched.
- **"Restore code" does not include "only" in its name**: While it only affects files, the name is intentionally "Restore code" (not "Restore code only") to keep the UI labels concise and natural.
- **Rewind is not undo**: `/rewind` lets the user pick any historical Checkpoint. `/undo` (provided by the UndoRedo Extension) always reverts to the most recent Checkpoint. They are different UX surfaces over the same Checkpoint data.

## Example dialogue

> **Dev**: I'm adding a new Restore Mode that exports the Turn's changes as a patch file. Where should I hook in?
>
> **Domain expert**: After the user selects a Checkpoint from the Checkpoint List, the handler resolves the `targetCp` from the selection index. Add your new mode to the `modes` array alongside the existing Restore Modes. Your handler receives the full `CheckpointEntry`, so you have access to `beforeCommit`, `afterCommit`, and `fileChanges`.
>
> **Dev**: Should my new mode run the dirty guard?
>
> **Domain expert**: Only if it modifies files. Look at "Restore conversation only" — it bypasses dirty guard because it only calls `navigateTree`. If your mode writes files (like exporting a patch to disk), you should pass `latest.afterCommit` as the `dirtyBaseCommit` to `safeCheckout` or an equivalent check.
>
> **Dev**: What if Auto Checkpoint is disabled? Should `/rewind` still work?
>
> **Domain expert**: `/rewind` reads Checkpoints from the session entries. If Auto Checkpoint is disabled, no new Checkpoints are created, but existing ones remain in the session history. The command warns "No checkpoints available" when the list is empty.
