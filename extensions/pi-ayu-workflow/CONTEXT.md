# Ayu Extension

Pi extension that provides the Ayu session Write Gate and `/ayu` workflow command router.

## Language

**Write Gate**:
The tool-call guard that runs while Write Mode is Off. It blocks direct file writes, mutating shell commands, nested mutating tools, and potentially mutating MCP calls. It allows read-only inspection and a narrow set of git inspection commands.
_Avoid_: permission system, sandbox, approval flow

**Write Mode**:
A boolean controlled by `Alt+S`, `/ayu on`, `/ayu write on`, `/ayu off`, and `/ayu write off`. Manual toggles are session-scoped. `/ayu on <prompt>` and `/ayu write on <prompt>` create a one-shot Write Mode grant that auto-turns Off after that agent run. Every agent turn gets an explicit mode prompt: Off steers discussion/planning/review/read-only inspection, while On steers small verified implementation.
_Avoid_: edit mode, agent mode, unlocked mode

**Ayu Workflow Router**:
The `/ayu` command dispatcher. It handles Write Mode controls directly and expands workflow subcommands (`task`, `review`, `docs`, `release`, `verify`, `audit`) into bundled prompt templates.
_Avoid_: prompt shortcut, command alias

**Prompt Template**:
A markdown file under `prompts/` with optional frontmatter. The router strips frontmatter and substitutes `$ARGUMENTS` / `$@` with the command tail before sending it as a user message.
_Avoid_: skill, canned response

**Editor Write Mode Label**:
The inline label prepended to the first editor border line: `Write Mode: On` or `Write Mode: Off`. This is intentionally rendered in the editor rather than as a footer status so it stays close to the input box.
_Avoid_: status bar label, footer indicator

## Flagged ambiguities

- **Write Gate is not a security boundary**: It is a workflow guard for AI tool calls. Extensions still run with the user's full system permissions.
- **Off mode is active guidance, not just blocking**: `before_agent_start` injects an Off-mode system prompt on every turn so the assistant plans, reviews, and inspects read-only instead of relying only on blocked tool calls.
- **On mode is constrained implementation**: The On-mode prompt allows writes but still requires current-request scope, relevant context, small vertical slices, no unrelated churn, and verification evidence.
- **Read-only git commands are intentionally narrow**: The gate permits `git status`, `git diff`, `git log`, `git show`, and `git branch --show-current` only when the command has no shell metacharacters and no disallowed output-conversion flags.
- **`/ayu on <prompt>` is one-shot**: It immediately runs the prompt and auto-turns Write Mode Off after that agent run. Bare `/ayu on` and `Alt+S` remain manual session-scoped toggles.
- **`/ayu off <prompt>` ignores the prompt**: It warns and ignores trailing text because turning Write Mode Off should not implicitly start work.
- **Prompt templates are bundled with the extension**: They are loaded from `prompts/` next to the built package, not from the user's `~/.pi/agent/ayu/prompts` directory.
- **Write Mode resets on session start**: New, resumed, forked, and reloaded sessions start with Write Mode Off. Session tree navigation reattaches the editor label but does not intentionally toggle the mode.

## Example dialogue

> **Dev**: I want `/ayu design` to send a new planning prompt. Where should I add it?
>
> **Domain expert**: Add a markdown file under `prompts/`, then add a key to `promptFiles` in `src/prompts.ts`. Keep the template frontmatter optional; `loadPrompt()` strips it before sending the prompt.
>
> **Dev**: Should it turn Write Mode On automatically?
>
> **Domain expert**: No. Workflow prompts are discussion/planning commands unless the user explicitly uses `/ayu on` or toggles `Alt+S`.
>
> **Dev**: A tool named `workspace.applyPatch` is being blocked. Is that expected?
>
> **Domain expert**: Yes. `mutatingToolNamePattern` treats `patch` / `apply` as mutating. The user must enable Write Mode before implementation.
