# Clarify Extension Context

## Purpose

`@ayulab/pi-clarify` gives Pi agents a structured `ask_user` tool for one-question-at-a-time clarification before acting.

It exists to avoid long question walls in CLI conversations. When missing information materially affects scope, files, package metadata, safety posture, or user-facing behavior, the agent can pause and ask exactly one answerable question through Pi's UI.

## Public Behavior

- Registers the `ask_user` tool.
- Registers `/clarify` for status and demo commands.
- Supports three prompt kinds:
  - `select` — choose one option, optionally with a custom text option;
  - `text` — provide a single-line free-form answer;
  - `confirm` — answer yes/no.
- Returns a structured answer as the tool result.
- Records a small custom session entry for each answer or cancellation.
- Rejects secret-like prompts and secret-like option labels.

## Boundaries

Clarify does not own Write Mode, mutating tool protection, checkpointing, or rollback. Those remain in `@ayulab/pi-write-gate`, `@ayulab/pi-rewind`, `@ayulab/pi-undo-redo`, and `@ayulab/pi-checkpoint`.

Clarify does not intercept or rewrite normal assistant text. It only constrains the structured `ask_user` tool path. If agents still produce multi-question text walls, that should be handled by a separate conversation policy extension.

Clarify intentionally does not provide password prompts. Secrets should not pass through model-mediated workflows; use environment variables, OS keychains, OAuth, or dedicated secret managers instead.

## Key Terms

- **Clarification Prompt**: One structured user question issued through `ask_user`.
- **One-question constraint**: The tool schema accepts a single prompt, not a batch of questions.
- **Custom Answer**: Free-form text entered after selecting the custom option for a `select` prompt.

## Files

- `src/index.ts` — extension registration, `/clarify`, and `ask_user` tool.
- `src/schema.ts` — request/response types, TypeBox schemas, validation helpers.

## Invariants

- `ask_user` must accept exactly one prompt per tool call.
- Do not add a `questions` array or batch flow.
- Do not add password/secret input support.
- Do not use single-key submit shortcuts that can accidentally approve a prompt.
- Prefer arrows + Enter, and Esc to cancel.
- In non-interactive mode, return a structured unavailable result instead of guessing.

## Verification Focus

When changing this extension, test:

- tool registration and `/clarify` command registration;
- select/text/confirm request validation;
- custom select answer normalization;
- secret-like prompt rejection;
- non-interactive behavior;
- session entry shape for answered and cancelled prompts.
