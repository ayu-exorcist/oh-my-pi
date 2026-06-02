---
description: Generate a verification plan for current changes
---

Generate a verification plan for the current changes or planned changes. Do not modify files unless the user explicitly requests it afterward.

First, read the project AGENTS.md, README.md, and any package/config sections related to verification.

Output:

## What must be verified

## Project-documented commands

## Minimal verification path

## Stronger verification path

## Manual checks, if needed

## Risks if skipped

Requirements:

- Prefer commands already documented by the project.
- Do not guess the package manager; state if it cannot be found.
- Do not delete or weaken tests to make checks pass.
- Warn first if a command may be slow or have side effects.
