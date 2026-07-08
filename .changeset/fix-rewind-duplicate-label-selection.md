---
"@ayulab/oh-my-pi": patch
"@ayulab/pi-rewind": patch
---

Fix `/rewind` selection when multiple checkpoints render identical labels, restore conversation rewinds to the selected user prompt so Pi places it back in the editor, and show code restore modes only when the selected-to-latest rewind range includes file changes. `/tree` file sync prompts now use the current-to-target navigation range instead of session-wide file-change history.
