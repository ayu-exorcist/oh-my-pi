# Write Gate Extension Context

## Purpose

`@ayulab/pi-write-gate` owns user-controlled Write Mode authorization and the Write Gate.

It is the runtime safety primitive that separates discussion/planning from implementation:

- Write Mode Off: planning, review, and read-only inspection; mutating tools are blocked.
- Write Mode On: user-authorized small verified implementation; mutating local tools are allowed.

## Public Behavior

- Registers `/write-gate` for Write Mode controls.
- Registers `Alt+S` to toggle Write Mode.
- Injects explicit On/Off mode instructions through `before_agent_start`.
- Blocks mutating tool calls in `tool_call` while Write Mode is Off.
- Shows a live editor label: `Write Mode: On` / `Write Mode: Off`.
- Persists user-set Write Mode across session resume/reload via session custom entries.

## Boundaries

Write Gate does not own Ayu workflow prompts. Task planning, review, docs sync, release check, verification, and audit prompts live in `@ayulab/pi-workflow`.

Write Gate is not a security sandbox. Pi extensions still run with the user's full system permissions. The gate is a workflow guard and safety affordance.

## Key Terms

- **Write Mode**: Session-local boolean state controlling whether mutating tools are allowed.
- **Write Gate**: `tool_call` policy that blocks mutating tools while Write Mode is Off.
- **Persisted Write Mode**: Last user-set Write Mode stored as a session custom entry (`pi-write-gate.state`) and restored on resume/reload.

## Files

- `src/index.ts` — extension registration, commands, lifecycle events, tool-call blocking.
- `src/gate.ts` — tool and shell command classification.
- `src/prompt.ts` — On/Off system prompt snippets.
- `src/ui.ts` — editor label and write-mode UI helpers.
- `src/state.ts` — session persistence for Write Mode state.

## Invariants

- Write Mode starts Off for **new** and **forked** sessions.
- Write Mode is **restored** for **resume**, **reload**, and **startup** sessions from the latest persisted state.
- User toggles (`/write-gate on|off`, `Alt+S`) immediately persist a state entry.
- No automatic state change occurs after an agent turn ends.
- Read-only git inspection commands remain allowed while Write Mode is Off.
- Unknown MCP actions or potentially mutating MCP tools are blocked while Write Mode is Off.
- Trailing prompts after `/write-gate on` are ignored; the user must send the prompt as a separate message.
- T3/T4 safety policy should be added here, not in `pi-workflow`.

## Verification Focus

When changing this extension, test:

- Off mode blocks mutating tools.
- Off mode allows narrow git inspection.
- On mode allows local mutating tools.
- Manual On mode persists across agent turns.
- New/fork sessions start Off.
- Resume/reload restores the last persisted state.
- `/write-gate` owns Write Mode controls; `/ayu` workflow commands do not maintain Write Mode state.
- Editor label reflects current state.
