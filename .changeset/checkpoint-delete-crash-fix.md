---
"@ayulab/pi-checkpoint": patch
"@ayulab/pi-rewind": patch
---

Return structured checkpoint-storage delete failures instead of throwing raw filesystem errors, retry Windows removals more defensively, and keep `/checkpoint` delete failures inside the selector UI instead of crashing Pi.
