# Compact Extension Context

## Purpose

`@ayulab/pi-compact` reduces information density in Pi sessions by compacting built-in tool output to one-line summaries. It pairs with `@ayulab/pi-clarify` so that decision-critical prompts stand out while exploration noise stays minimal.

## Public Behavior

- Overrides renderers for 7 built-in tools: `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`.
- **Collapsed mode** (default): each tool result shows a single-line summary (line count, match count, exit status, diff stat).
- **Expanded mode** (`Ctrl+O`): shows full output via simple text rendering.
- `/compact on | off | status` toggles the mode per session.
- State persists across session reloads via custom session entries.

## Boundaries

Compact does not modify tool execution logic — it only replaces `renderCall`/`renderResult`. Execution is delegated to the original built-in tools.

Compact does not affect `@ayulab/pi-clarify` or any other extension's `ask_user` rendering. Clarify overlays and compact summaries are independent layers.

Compact does not cover MCP tools, `web_search`, `fetch_content`, or `code_search`. Those remain rendered by their owning packages.

## Files

- `src/index.ts` — extension registration, tool overrides, `/compact` command, state management.

## Invariants

- `execute` delegates to the original built-in tool; no behavior change.
- `renderResult` in expanded mode shows full text output.
- `renderResult` in collapsed mode shows exactly one summary line.
- State defaults to `enabled`; survives session reload.

## Verification Focus

- Tool registration for all 7 overridden tools.
- `/compact` command and state persistence.
- Collapsed vs expanded render output.
- Non-interactive / no-UI behavior unchanged.
