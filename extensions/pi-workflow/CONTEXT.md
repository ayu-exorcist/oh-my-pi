# Ayu Workflow Extension Context

## Purpose

`@ayulab/pi-workflow` owns the `/ayu` workflow prompt router and the `/plan` Plan Mode.

It packages reusable Ayu workflow prompts for:

- task planning;
- diff review;
- docs sync;
- release readiness checks;
- verification reports;
- AI-engineering audits.

It also provides **Plan Mode**: a read-only research phase where the agent explores the codebase, drafts a structured implementation plan, and waits for user approval before executing.

## Public Behavior

- Registers `/ayu`.
- Registers `/plan` for Plan Mode.
- `/ayu help` shows workflow help.
- `/ayu task <goal>` sends the task-planning prompt.
- `/ayu review [focus]` sends the diff-review prompt.
- `/ayu docs [scope]` sends the docs-sync prompt.
- `/ayu release [scope]` sends the release-check prompt.
- `/ayu verify [criteria]` sends the verification prompt.
- `/ayu audit [scope]` sends the project audit prompt.
- `/ayu plan cleanup` deletes plan files older than 30 days from `~/.pi/plans/`.
- `/ayu plan cleanup --dry-run` previews files that would be deleted.
- `/plan <goal>` enters Plan Mode: agent researches read-only, writes plan to `~/.pi/plans/`.
- `/plan --local <goal>` stores the plan in `.pi/plans/` within the project.
- If Pi is busy, prompts are queued as follow-up messages.

## Plan Mode Details

### Flow

1. User sends `/plan <goal>`.
2. Extension sets `planModeActive = true`, generates a plan file path, and sends the plan mode prompt.
3. `before_agent_start` injects plan mode context (file path + rules) into the system prompt.
4. `tool_call` blocks all mutating tools while plan mode is active.
5. Agent researches read-only, writes plan to the designated file path.
6. Agent uses `ask_user` (via `@ayulab/pi-clarify`) to present options:
   - **A. Execute now** — agent sends `/write-gate on` then implements
   - **B. Edit plan** — opens plan in `$EDITOR`
   - **C. Refine** — continues discussion
   - **D. Cancel** — discards plan and exits plan mode
7. After execution or cancellation, plan mode deactivates.

### Storage

| Flag             | Location                                             | Use case                               |
| ---------------- | ---------------------------------------------------- | -------------------------------------- |
| (default)        | `~/.pi/plans/<project>-<hash>/<timestamp>-<slug>.md` | User-level, auto-cleanup after 30 days |
| `--local` / `-l` | `.pi/plans/<timestamp>-<slug>.md`                    | Project-level, persists with the repo  |

### Cleanup

- Automatic: every new plan creation triggers cleanup of files older than 30 days in `~/.pi/plans/`.
- Manual: `/ayu plan cleanup` or `/ayu plan cleanup --dry-run`.
- Project-level `.pi/plans/` is never auto-cleaned.

## Boundaries

Ayu Workflow does not own Write Mode, Write Gate, system-prompt mode injection, mutating tool blocking, or the editor label. Those live in `@ayulab/pi-write-gate`.

Plan Mode blocks mutating tools independently during the research phase, but execution requires `@ayulab/pi-write-gate` Write Mode On.

If users call old Write Mode commands through `/ayu`, this extension only shows a migration warning. It does not maintain Write Mode state.

## Key Terms

- **Workflow prompt**: A bundled markdown prompt under `prompts/` loaded by command alias.
- **Prompt router**: The `/ayu` command handler that maps aliases to prompt files.
- **Follow-up prompt**: A prompt queued with `deliverAs: "followUp"` when Pi is not idle.
- **Plan Mode**: Read-only research phase with structured plan generation and user approval.
- **Plan file**: Markdown file written by the agent containing implementation steps.

## Files

- `src/index.ts` — `/ayu` and `/plan` command registration, event handlers.
- `src/prompts.ts` — prompt alias mapping, frontmatter stripping, argument substitution.
- `src/plan.ts` — Plan Mode state machine, file path generation, cleanup logic, tool blocking.
- `prompts/*.md` — bundled workflow prompt templates.

## Invariants

- `/ayu` workflow commands must not directly mutate files.
- `/ayu release` is a readiness check only; it must not publish, tag, or push.
- Write Mode controls should stay in `pi-write-gate`.
- Plan Mode blocks mutating tools during research, regardless of Write Gate state.
- New workflow prompts should be short, task-oriented, and argument-driven.
- Plan files use timestamp + slug naming; no overwrites.

## Verification Focus

When changing this extension, test:

- prompt aliases resolve to the expected files;
- `$ARGUMENTS` and `$@` substitution works;
- prompt frontmatter is stripped;
- `/ayu` queues follow-up prompts when Pi is busy;
- Write Mode commands produce migration warnings rather than managing state;
- `/plan` enters plan mode and generates correct file paths;
- `/plan --local` stores plans in `.pi/plans/`;
- plan mode blocks mutating tools via `tool_call`;
- plan mode injects context via `before_agent_start`;
- `/ayu plan cleanup` removes old files;
- `/ayu plan cleanup --dry-run` does not delete files.
