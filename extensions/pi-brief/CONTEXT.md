# Brief Extension Context

## Purpose

`@ayulab/pi-brief` reduces information density in Pi sessions by briefing built-in tool output to one-line summaries. It pairs with `@ayulab/pi-clarify` so that decision-critical prompts stand out while exploration noise stays minimal.

## Public Behavior

- Overrides renderers for 7 built-in tools: `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`.
- **Collapsed mode** (default): each tool result shows a single-line summary tailored to that tool.
- **Expanded mode**: shows full output via simple text rendering.
- `/brief on | off | status` toggles the mode per session.
- State persists across session reloads via custom session entries.

## Boundaries

Brief does not modify tool execution logic — it only replaces `renderCall`/`renderResult`. Execution is delegated to the original built-in tools.

Brief does not affect `@ayulab/pi-clarify` or any other extension's `ask_user` rendering. Clarify overlays and brief summaries are independent layers.

Brief does not cover MCP tools, `web_search`, `fetch_content`, or `code_search`. Those remain rendered by their owning packages.

## Files

- `src/index.ts` — extension registration, tool overrides, `/brief` command, state management.

## Invariants

- `execute` delegates to the original built-in tool; no behavior change.
- `renderResult` in expanded mode shows full text output.
- `renderResult` in collapsed mode shows exactly one summary line.
- State defaults to `enabled`; survives session reload.

## Verification Focus

- Tool registration for all 7 overridden tools.
- `/brief` command and state persistence.
- Collapsed vs expanded render output.
- Non-interactive / no-UI behavior unchanged.
