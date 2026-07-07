---
"@ayulab/pi-checkpoint": patch
"@ayulab/pi-rewind": patch
---

Fix checkpoint lock recovery so malformed stale lock paths do not busy-loop during automatic checkpoints, and add clear timeout warnings for lock waits and Git subprocesses.
