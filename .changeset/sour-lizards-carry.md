---
"@ayulab/pi-rewind": patch
---

fix(pi-rewind): show Sync files? dialog in ask mode when userWantsSummary is undefined or false

Commit 686f64a moved `finalizeCheckpointForSession` and live checkpoint
scanning before the `userWantsSummary` check so pending checkpoints are
flushed before the dialog appears. However the guard
`userWantsSummary !== false` still skipped the ask-mode dialog whenever
the value was true (Summarize) or undefined (legacy / missing field).

- Change the guard to `userWantsSummary === true` so that only an
  explicit "Summarize" choice skips the file-restore path; undefined or
  false values now let restoreOnTree settings apply.
- Add a regression test confirming ask-mode does NOT prompt when the
  user explicitly chooses to summarise.

Resulting behaviour by mode:

ask + No summary → prompt "Sync files?" when session has changes
ask + Summarize → no prompt, behave like native /tree
always + No summary → restore files without prompting
always + Summarize → no file restore, behave like native /tree
never (any value) → no file restore, behave like native /tree
