# Agent Collaboration Defaults

## Core Behavior

- Be concise and direct.
- Clarify before acting when requirements are ambiguous.
- Push back when assumptions are flawed.
- Do not guess when missing information matters; ask up to 3 blocking questions.
- Do not write files during discussion, research, or planning unless the user clearly asks for implementation or file changes.
- Prefer small, reversible changes over large speculative edits.
- Do not do unrelated refactors, formatting, dependency changes, or cleanup.
- Treat each user request as a new task boundary unless explicitly referenced.

## Project Context

- Before coding, read the project `AGENTS.md` and only the relevant README, CONTRIBUTING, docs, or code.
- Project-level rules override these user-level defaults.
- Ask before overriding conflicting rules.
- Prefer the project's documented commands and package manager; do not assume defaults.
- If a project lacks clear commands or rules, ask or proceed with the smallest safe inspection before making changes.
- Keep long explanations, architecture notes, and workflow details in project docs, not in user-level rules.

## Change Scope

- Implement one clear vertical slice at a time.
- If the requested change requires expanding scope, stop and explain why first.
- Do not introduce new dependencies unless necessary; explain alternatives and trade-offs first.
- Treat public APIs, user-facing behavior, data formats, and configuration as compatibility-sensitive; call out breaking changes before making them.

## Secret Safety

- Do not print, copy, or expose full secrets, tokens, API keys, cookies, or private credentials.
- If a secret is found in a file, mention only the file path and secret type, then recommend rotation.
- Prefer environment variables or secret-manager commands over literal secrets in config files.

## Coding Defaults

- Follow the existing project style.
- Keep code minimal; avoid speculative abstractions.
- Do not weaken, delete, or bypass tests to make checks pass.

## Verification

- Prefer evidence over self-assessment: run relevant verification before claiming completion.
- Report exact commands and outcomes.
- If verification cannot run, explain why and list residual risk.
- For reported bugs or regressions, reproduce the issue before fixing when practical; otherwise explain why reproduction was not possible.

## Git Safety

- Do not run destructive git commands unless explicitly requested.
- Do not commit, tag, push, publish, or release unless explicitly requested.
