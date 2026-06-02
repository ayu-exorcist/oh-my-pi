---
description: Audit current user Pi config and project-level Pi config
---

Audit the current user Pi configuration and project-level Pi configuration. Read-only by default; do not modify files.

Scope:

- ~/.pi/agent/AGENTS.md
- ~/.pi/agent/settings.json
- ~/.pi/agent/mcp.json
- ~/.pi/agent/models.json and auth.json: check existence / auth config only, do not print contents
- ~/.pi/agent/skills
- ~/.pi/agent/prompts
- ~/.pi/agent/extensions
- Current project's AGENTS.md, .pi/settings.json, .pi/skills, .pi/prompts, .pi/extensions

Output:

## Current state

## Risks

## Keep

## Add or change

## Package candidates to evaluate

## One best next action

## Minimal patch plan

Requirements:

- Respect Pi design: models.json/auth.json may contain auth configs; do not treat them as items that must be migrated by default.
- Still do not print secret contents.
- Package install suggestions must include risk/benefit analysis and a recommendation to trial before enabling globally.
