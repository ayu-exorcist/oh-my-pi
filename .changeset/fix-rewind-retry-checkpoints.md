---
"@ayulab/oh-my-pi": patch
"@ayulab/pi-rewind": patch
---

Keep `/rewind` aligned with visible user turns by collapsing retry-generated checkpoint duplicates, avoiding duplicate checkpoint entries for transient model retries, and restoring conversation state to the selected turn instead of jumping across later prompts.
