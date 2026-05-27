---
description: Run a release readiness check without publishing
argument-hint: "[version-or-scope]"
---

Perform a release readiness check for: $ARGUMENTS

Do not publish, tag, push, or change remote state unless I explicitly confirm later.
Do not run package-manager release scripts unless they are documented as dry-run or check-only.

Check:

1. Package/release configuration.
2. Current version and changelog status.
3. README examples and quickstart validity.
4. Tests, lint, typecheck, build, and project `check` command if available.
5. Changes since previous tag or release point.
6. Breaking changes and migration notes.
7. Release note draft grouped by Breaking Changes / Features / Fixes / Docs / Internal.
8. Release risks and rollback plan.

Report exact commands run and results. If a command cannot run, explain why and the risk.
