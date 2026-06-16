# Rewind Extension

Pi extension that automatically captures a Checkpoint for every Turn and provides the `/rewind` command for interactive checkpoint navigation.

## Language

**Auto Checkpoint**:
The automatic creation of a Checkpoint around each Turn. Controlled by `CheckpointConfig.autoCheckpoint`. Requires no user intervention.
_Avoid_: implicit checkpoint, automatic save, per-turn snapshot

**Rewind**:
The `/rewind` command that presents an interactive Checkpoint List and restores the workspace and/or conversation to a selected historical checkpoint.
_Avoid_: rollback, revert, go back, restore

**Checkpoint List**:
The interactive selection UI presented by `/rewind`, showing historical Checkpoints with their Prompt Preview and File Change Stats.
_Avoid_: history, timeline, snapshot list

**Restore Mode**:
The options presented after selecting a Checkpoint in `/rewind`. When the active Checkpoint List has file changes, three options are shown; when it has no file changes, code restore options are hidden.

1. **Restore code and conversation** — checkout `beforeCommit` and navigate to the Turn's user entry with `summarize: false`, so the selected prompt is ready to run again.
2. **Restore conversation** — navigate to the Turn's user entry with `summarize: false` without checking out files. Bypasses dirty guard because no filesystem changes occur.
3. **Restore code** — checkout `beforeCommit` without changing the conversation position.
   _Avoid_: restore option, recovery mode, action

**Prompt Preview**:
The truncated user prompt (up to 60 characters) displayed in the Checkpoint List to help identify which Turn produced each Checkpoint.
_Avoid_: prompt summary, message label, turn title

**File Change Stats**:
The per-file addition and removal counts (`+added -removed`) shown in the Checkpoint List for each Checkpoint. Derived from `CheckpointEntry.fileChanges`.
_Avoid_: diff stats, change metrics, file metrics

## Flagged ambiguities

- **"Restore conversation" bypasses dirty guard**: This is deliberate. Because no filesystem checkout occurs, there is no risk of overwriting unsaved work. The user's working tree remains untouched.
- **"Restore code" does not include "only" in its name**: While it only affects files, the name is intentionally "Restore code" (not "Restore code only") to keep the UI labels concise and natural.
- **Rewind is not quick undo**: `/rewind` lets the user pick any historical Checkpoint from a list instead of only stepping back to the most recent Checkpoint.
- **Tree file restore is opt-in**: Pi-native `/tree` only changes conversation state. `pi-rewind` preserves that by default; set `ayu.rewind.restoreOnTree` to `"ask"` or `"always"` to offer or perform file sync after Pi's native `No summary` choice. In `ask`, the extension caches whether any checkpoint in the current session has ever changed files, so one changed checkpoint keeps later `/tree` prompts enabled for that session. Summary navigation does not restore files.
- **`Sync files?` Esc cannot return to `/tree` yet**: In `restoreOnTree: "ask"`, Pi opens the extension `Sync files?` dialog only after the built-in tree selector has already called `done()` and closed. Without changing Pi's package implementation, an extension cannot keep `/tree` open or return focus to its previous level, so Esc cancels the sync prompt instead of navigating back inside `/tree`. If Pi exposes a supported hook before the selector closes, implement the behavior through that API rather than emulating tree navigation.
- **`ayu` merges recursively across scopes**: Project settings override user settings field-by-field, and missing values fall back to defaults. `pi-rewind` documents `ayu.rewind` examples directly; checkpoint behavior remains in `ayu.checkpoint`.
- **Session deletion is not inferred**: If users delete sessions via `pi -r` or `/resume` with `Ctrl+D`, Pi currently has no documented deletion lifecycle hook for extensions. Do not auto-delete checkpoint storage by guessing from missing JSONL files. If Pi later adds `session_before_delete` / `session_deleted`, use that exact hook to delete only the matching session's checkpoint storage and clear related in-memory state.

## Example dialogue

> **Dev**: I'm adding a new Restore Mode that exports the Turn's changes as a patch file. Where should I hook in?
>
> **Domain expert**: After the user selects a Checkpoint from the Checkpoint List, the handler resolves the `targetCp` from the selection index. Add your new mode to the `modes` array alongside the existing Restore Modes. Your handler receives the full `CheckpointEntry`, so you have access to `beforeCommit`, `afterCommit`, and `fileChanges`.
>
> **Dev**: Should my new mode run the dirty guard?
>
> **Domain expert**: Only if it modifies files. Look at "Restore conversation" — it bypasses dirty guard because it only calls `navigateTree`. If your mode writes files (like exporting a patch to disk), you should pass `latest.afterCommit` as the `dirtyBaseCommit` to `safeCheckout` or an equivalent check.
>
> **Dev**: What if Auto Checkpoint is disabled? Should `/rewind` still work?
>
> **Domain expert**: `/rewind` reads Checkpoints from the session entries. If Auto Checkpoint is disabled, no new Checkpoints are created, but existing ones remain in the session history. The command warns "No checkpoints available" when the list is empty.
