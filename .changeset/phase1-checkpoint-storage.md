---
"@ayulab/oh-my-pi": patch
"@ayulab/pi-checkpoint": patch
"@ayulab/pi-rewind": patch
---

Finish phase 1 of the checkpoint storage fix:

- harden checkpoint restore preflight with fail-closed checkout behavior and clearer restore failure handling
- expand built-in checkpoint excludes, add `ayu.checkpoint.include`, and add opt-in `ayu.checkpoint.maxFileMB`
- make resume conversation-only by default with `restoreOnResume: "never"`, while keeping `/tree` conversation-first and preserving fork and clone restore defaults
- add `/checkpoint` storage management with per-storage manifests, orphan detection, and explicit delete
- document the phase 1 nested Git repository boundary and storage-management behavior
- refresh workspace development typing to `@types/node@26`
