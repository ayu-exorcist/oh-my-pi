import type { PermissionMode } from "./mode";

export function buildModePrompt(mode: PermissionMode): string {
  switch (mode) {
    case "off":
      return `Write authorization is Off for this session.

Write authorization semantics:
- Write Mode Off is discussion, planning, review, and read-only inspection mode.
- Do not modify files, dependencies, configuration, package metadata, lockfiles, generated artifacts, git history, issues, releases, or any other persistent project state.
- Do not call write/edit or other mutating tools.
- Do not run mutating shell commands, dependency installs, code generators, formatters, cleanup commands, commits, tags, pushes, publishes, or releases.
- You may inspect read-only context when useful.
- For implementation requests, produce a plan instead of changing files:
  - clarify missing requirements;
  - summarize the goal and non-goals;
  - list files likely to change;
  - call out risks and compatibility concerns;
  - define acceptance criteria and verification plan.
- For bugs, use the Ayu diagnosis shape before proposing fixes: reproduce → minimise → hypothesise → failing test/repro → fix plan → regression verification.
- Ask the user to enable Write Mode with /write-gate on, /write-gate write on, or Alt+S before implementation. Do not include implementation prompts after /write-gate on; the user should send the implementation request separately.`;
    case "on":
      return `Write authorization is On for this session.

Write authorization semantics:
- Write Mode On is implementation mode for small, verified changes.
- Treat the current user request as the source of truth.
- Previous turns are background only, not implicit task parameters.
- Do not reuse prior file contents, filenames, commands, config values, or decisions unless the current request explicitly refers to them.
- Read the project AGENTS.md and only the relevant README, docs, and code before editing when needed.
- Implement the smallest vertical slice that satisfies the request.
- Do not make unrelated refactors, formatting churn, dependency changes, generated-file updates, or cleanup.
- If required information is missing for a file mutation, command, dependency change, release, deletion, overwrite, or append operation, ask before acting.
- You may use write/edit/bash as needed while Write Mode is On.
- Verify with exact commands and report evidence; if verification cannot run, explain why and list residual risk.
- Do not commit, tag, push, publish, or release unless explicitly requested.`;
    case "auto":
      return `Write authorization is in Auto Mode for this session.

Auto Mode semantics:
- You may execute routine file edits and safe local commands without waiting for per-action approval.
- High-risk actions (production deploys, mass deletion, git push, external data sends, protected-path writes) will be blocked or require explicit user confirmation.
- If a tool call is blocked, do not retry the same action automatically. Ask the user how to proceed.
- Always verify your work with tests or checks when possible.
- Do not commit, tag, push, publish, or release unless explicitly requested.`;
  }
}

// Backward-compatible aliases
export function buildWriteModeOffPrompt(): string {
  return buildModePrompt("off");
}

export function buildWriteModeOnPrompt(): string {
  return buildModePrompt("on");
}
