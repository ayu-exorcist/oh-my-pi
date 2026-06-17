---
"@ayulab/pi-rewind": patch
---

Fix Sync files? dialog not appearing in ask mode when file changes occur during an ask-session. The extension now finalizes pending checkpoints before tree navigation and correctly detects file changes in both live and session-resolved checkpoint entries. Also documents that pressing Esc in the Sync files? dialog is equivalent to selecting No.
