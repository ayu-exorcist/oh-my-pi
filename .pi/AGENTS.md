# Agent Collaboration Defaults

## Core Behavior

- Be concise and direct.
- Clarify before acting when requirements are ambiguous.
- Push back when assumptions are flawed.
- Do not guess when missing information matters; ask up to 3 blocking questions.
- Do not write files during discussion, research, or planning unless explicitly asked.
- Prefer small, reversible changes over large speculative edits.
- Do not do unrelated refactors, formatting, dependency changes, or cleanup.
- Treat each request as a new task boundary unless explicitly referenced.

## Work Style

1. Read relevant files and output a brief plan before coding.
2. Ask first when uncertain (up to 3 blocking questions); do not guess.
3. When fixing bugs, write a reproduction test or list reproduction steps first.
4. Make only minimal changes; keep diffs small.
5. Run minimal relevant verification after changes; report exact commands and outcomes.
6. Output a final change summary, verification result, risks, and follow-up suggestions.
7. Stop after two consecutive failures; output failure attribution and next diagnostic action.

## Project Context

- Before coding, read the project `AGENTS.md` and only the relevant README, CONTRIBUTING, docs, or code.
- Project-level rules override user-level defaults.
- Ask before overriding conflicting rules.
- Prefer the project's documented commands and package manager.
- If a project lacks clear commands or rules, ask or proceed with the smallest safe inspection.
- Keep long explanations in project docs, not in user-level rules.

## Change Scope

- Implement one clear vertical slice at a time.
- If the requested change requires expanding scope, stop and explain why first.
- Do not introduce new dependencies unless necessary; explain alternatives and trade-offs first.
- Treat public APIs and user-facing behavior as compatibility-sensitive.

## Tool Permission Matrix

Judge by side effect, not by tool name.

- **T0 read**: Read files, search, read-only logs/DB/API. Default allowed; reject or request confirmation for secrets, PII, or restricted data.
- **T1 write-local**: Modify workspace files, generate local reports. Allowed for small scope; protect sensitive paths and preserve diff and verification evidence.
- **T2 external-send**: Email, Slack, GitHub issue/comment, external HTTP POST. Must provide recipient/content summary/risk explanation and wait for confirmation.
- **T3 irreversible**: Delete, data migration, bulk irreversible changes. Default deny; if required, provide dry-run, backup, rollback plan, and confirmation evidence.
- **T4 production-mutating**: Production DB writes, production config, payment/refund, permission changes, release/deploy/tag/push. Default deny; execution requires explicit ticket and confirmation.

## Secret Safety

- Do not print, copy, or expose full secrets, tokens, API keys, cookies, or private credentials.
- If a secret is found in a file, mention only the file path and secret type, then recommend rotation.
- Prefer environment variables or secret-manager commands over literal secrets in config files.

## Coding Defaults

- Follow the existing project style.
- Keep code minimal; avoid speculative abstractions.
- Do not weaken, delete, or bypass tests to make checks pass.
- Do not edit unrelated files or change formatting not related to the task.

## Verification

- Prefer evidence over self-assessment: run relevant verification before claiming completion.
- Report exact commands and outcomes.
- If verification cannot run, explain why and list residual risk.
- For reported bugs or regressions, reproduce the issue before fixing when practical.

## Harness Self-Iteration

- Do not append long-term rules from a single failure; record to `.pi/ayu/tasks/ai-notes.md` or an iteration card first.
- Important harness changes must use a fixed benchmark suite for before/after comparison.
- Prompt/skill/tool description changes prefer bounded add/delete/replace; record rejected variants.
- Prefer mechanizing rules into tests, lint, schema, CI, or hooks; keep natural language rules short.
- Changing models requires a separate baseline; do not count model improvement as harness improvement.

### Rule Bloat Guard

- Do not append long-term rules from a single failure. Record to `.pi/ayu/tasks/ai-notes.md` or an iteration card first.
- Before adding a new AGENTS.md rule, check: is it from a real failure? Is it frequent and general?
- Only promote to long-term rules after held-out/transfer validation.

## Source & Claim Governance

### Source Tiers (S0–S3)

- **S0**: Peer-reviewed paper, official spec, source code, authoritative docs.
- **S1**: Official blog, engineering post, conference talk, well-maintained open source.
- **S2**: Secondary report, analyst note, curated newsletter.
- **S3**: Social media, forum, chat log, unverified blog; treat as clue only by default.

### Rules

- Strong claims, benchmark numbers, and industry statistics must be traceable to S0/S1 or clearly marked cross-validation.
- S2/S3 sources are clues by default; do not write them as strong facts without S0/S1 backing.
- When citing external facts, industry numbers, API behavior, or benchmark conclusions, provide source path / URL and source tier.

## Git Safety

- Do not run destructive git commands unless explicitly requested.
- Do not commit, tag, push, publish, or release unless explicitly requested.

## Pi Collaboration Rules

- At the start of each session, check what skills exist under `.pi/skills/` and `.agents/skills/`.
- Before executing any task, determine if a relevant skill exists; if so, read and follow the corresponding `SKILL.md` first.
- Do not skip workflows, checklists, or stop conditions defined in skills.
- Pi reads user-level `~/.pi/agent/AGENTS.md` first, then searches upward for project-level `AGENTS.md`.
- At the end of each session, update `.pi/workspace/journal.md` if it exists.
