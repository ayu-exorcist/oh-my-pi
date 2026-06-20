---
"@ayulab/pi-checkpoint": minor
"@ayulab/pi-rewind": minor
---

Fix checkpoint storage growth and restore safety for issue #13.

Checkpoints now use Worktree Checkpoint Storage under `~/.pi/agent/ayu/checkpoints/worktrees/<worktree-id>/`, so sessions, forks, clones, and resumes in the same resolved work tree share file-state object storage instead of creating per-session repos. Legacy per-session file storage under `~/.pi/agent/ayu/checkpoints/sessions/` and temporary checkpoint artifacts are cleaned asynchronously; old Pi conversation history remains available, but legacy file snapshots are not migrated or cloned into the new storage.

Checkpoint entries now store `beforeState` and `afterState` file-state refs. `/rewind` keeps legacy conversation nodes visible, disables file restore when file state is legacy, expired, or cleaned, and keeps conversation-only restore available. Checkpoint commits are protected by explicit session-entry refs rather than permanent branch history, so deleting orphan or retention-expired refs allows Git GC to reclaim unreferenced file-state objects.

Restore defaults and safety changed: `restoreOnResume` now defaults to `never`; `restoreOnFork` and `restoreOnClone` remain `always`; `restoreOnTree` remains `never`. Dirty checkpoint-managed files block restore, dirty-check failures fail closed with a distinct `dirty-check-failed` result, and cleanup fails closed if live session scanning, path validation, or ref validation cannot be verified.

Restore commitment is limited to checkpoint-managed files under the session cwd. Built-in excludes, user `ayu.checkpoint.exclude`, project `.gitignore` rules, nested `.gitignore` rules, nested Git repo excludes, and files above an opt-in `ayu.checkpoint.maxFileBytes` cap are outside file restore. User `ayu.checkpoint.exclude` now appends to built-in safety/cost defaults instead of replacing them; defaults now include common dependencies, generated build outputs, caches, IDE folders, logs, and temp files while intentionally not excluding `vendor/` or `*.d.ts`.

`ayu.checkpoint.maxFileBytes` is unset by default to match Gemini CLI's git-backed checkpoint behavior. If users configure a per-file cap, files above the limit are skipped with a once-per-session warning and are outside restore. File-restore retention defaults to enabled with `maxAge: "30d"`, `minRetention: "1d"`, and no default `maxCount`. `/checkpoint cleanup` dry-runs by default and `/checkpoint cleanup --apply` removes legacy storage plus orphan and retention-expired refs, then runs GC without deleting Pi conversation history or protected active worktree storage.
