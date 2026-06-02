---
description: Read-only audit of the current project for AI collaboration friction
---

Audit the current project read-only. Do not modify files.

Follow these steps:

1. Read the project-level AGENTS.md (if it exists) and README.md.
2. Read only docs/code/config directly related to the audit target.
3. Do not install dependencies, run destructive commands, or write files.
4. If a secret is found, report only the file path and secret type. Do not print the content.

Output format:

## Current state

## Biggest friction for AI collaboration

## Keep

## Add or change

## Move/delete

## One best next action

## Suggested minimal patch plan

Requirements:

- Sort by priority.
- Distinguish between "suggestions" and "verified facts".
- If files need to be changed, provide a patch plan first and wait for confirmation.
