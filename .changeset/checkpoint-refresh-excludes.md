---
"@ayulab/oh-my-pi": patch
"@ayulab/pi-checkpoint": patch
"@ayulab/pi-rewind": patch
---

Refresh checkpoint exclude rules for existing and cloned storage, refresh auto-discovered embedded Git repository excludes before each staging operation, ignore nested node_modules directories by default, and remove already-indexed ignored entries from checkpoint indexes.

This prevents broad workspace checkpoints and fork/clone restores from indexing embedded repositories or cleaning excluded work tree content.
