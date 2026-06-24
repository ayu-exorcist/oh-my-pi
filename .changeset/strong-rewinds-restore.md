---
"@ayulab/pi-rewind": minor
"@ayulab/pi-checkpoint": minor
---

Update `pi-rewind` restore behavior so `/tree` defaults to `ayu.rewind.restoreOnTree: "ask"`, while `restoreOnTree: "always"`, `restoreOnResume: true`, `restoreOnFork: true`, and `restoreOnClone: true` force restore checkpoint-managed files without a dirty-workspace prompt. `restoreOnResume` now also applies when opening an existing session from startup selection such as `pi -r`.

Restore feedback is now tied to the actual restore target: existing-session and `/tree` storage failures show warning-themed messages above the editor input, distinguish whole-session storage loss from a selected checkpoint commit missing in storage, and clear on the next user input. `/rewind` continues to report missing code-restore storage through its command UI while keeping conversation restore available.

For `@ayulab/pi-checkpoint`, checkpoint storage deletion now treats an already-removed storage directory as a successful delete after path, manifest, and active-session safety checks have passed, avoiding stale-selector `ENOENT` failures.
