---
"@ayulab/oh-my-pi": patch
---

Harden release publishing by running commands without shell string interpolation and publishing from an isolated temporary workspace instead of rewriting the root manifest in place.
