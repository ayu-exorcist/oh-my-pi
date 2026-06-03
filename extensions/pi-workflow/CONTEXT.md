# Ayu Workflow Extension Context

## Purpose

`@ayulab/pi-workflow` owns the `/ayu` workflow prompt router.

It packages reusable Ayu workflow prompts for:

- autonomous goal execution;
- task planning;
- read-only implementation planning;
- bug diagnosis and repair;
- diff review;
- docs sync;
- release readiness checks;
- verification reports;
- journal updates;
- harness iteration cards;
- benchmark run reports;
- AI-engineering audits.

## Public Behavior

- Registers `/ayu`.
- `/ayu help` shows workflow help.
- `/ayu goal <objective>` sends the autonomous goal prompt.
- `/ayu task <goal>` sends the task-planning prompt.
- `/ayu plan <goal>` sends the read-only planning prompt.
- `/ayu bug <description>` sends the reproduce→test→fix→verify prompt.
- `/ayu review [focus]` sends the diff-review prompt.
- `/ayu docs [scope]` sends the docs-sync prompt.
- `/ayu release [scope]` sends the release-check prompt.
- `/ayu verify [criteria]` sends the verification prompt.
- `/ayu journal` sends the session journal update prompt.
- `/ayu harness-iteration` sends the harness iteration card prompt.
- `/ayu benchmark [suite]` sends the benchmark report prompt.
- `/ayu audit [scope]` sends the project audit prompt.
- If Pi is busy, prompts are queued as follow-up messages.

## Boundaries

Ayu Workflow only sends prompt templates. It does not own permission enforcement, Write Mode state, tool gating, mutating tool blocking, checkpointing, rollback, or editor labels.

Permission enforcement is handled by a user-installed permission system. Ayu Workflow prompts may describe read-only or verification behavior, but enforcement must happen outside this extension.

## Key Terms

- **Workflow prompt**: A bundled markdown prompt under `prompts/` loaded by command alias.
- **Prompt router**: The `/ayu` command handler that maps aliases to prompt files.
- **Follow-up prompt**: A prompt queued with `deliverAs: "followUp"` when Pi is not idle.
- **Structured output block**: A named XML-like wrapper such as `<proposed_plan>`, `<task_card>`, `<bug_report>`, `<review_report>`, or `<verification_report>`.

## Files

- `src/index.ts` — `/ayu` command registration and routing.
- `src/prompts.ts` — prompt alias mapping, frontmatter stripping, argument substitution.
- `prompts/*.md` — bundled workflow prompt templates.

## Invariants

- `/ayu` workflow commands must not directly mutate files.
- `/ayu plan` is a read-only planning prompt; it must not implement.
- `/ayu release` is a readiness check only; it must not publish, tag, or push.
- New workflow prompts should be short, task-oriented, and argument-driven.
- Prompt-only workflow changes must not add external task/question packages.

## Verification Focus

When changing this extension, test:

- prompt aliases resolve to the expected files;
- `$ARGUMENTS` and `$@` substitution works;
- prompt frontmatter is stripped;
- `/ayu` queues follow-up prompts when Pi is busy;
- help text lists registered prompt aliases;
- structured prompt output requirements remain clear and non-conflicting.
