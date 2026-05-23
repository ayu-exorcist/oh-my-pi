# ADR-0004: Local Markdown as Issue Tracker

## Status

Accepted

## Context

We need a lightweight way to track work, bugs, and feature requests for `oh-my-pi`. The project is primarily a solo effort with occasional external contributions. The overhead of a full GitHub Issues workflow (labels, milestones, project boards) feels disproportionate to the actual needs.

Options considered:

1. **GitHub Issues** — Native integration, rich ecosystem, but requires `gh` CLI and network access.
2. **GitLab Issues** — Similar to GitHub, but the repo is on GitHub.
3. **Local markdown files** — Plain files under `.scratch/<feature>/`, version-controlled alongside code.
4. **Linear / Jira** — Too heavy for a solo open-source project.

## Decision

Use **local markdown files** under `.scratch/<feature-slug>/` as the issue tracker.

Conventions:

- One feature per directory: `.scratch/<feature-slug>/`
- PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Triage state recorded as a `Status:` line in the issue file frontmatter

This decision is documented in `docs/agents/issue-tracker.md` so that agent skills (`to-issues`, `triage`, `to-prd`) know how to read and write issues.

## Consequences

### Positive

- **Zero dependencies**: no CLI tools, no network, no auth tokens.
- **Version-controlled**: issues live in git, so they have history and can be reviewed in PRs.
- **Offline-first**: works on planes, in VMs, or behind corporate firewalls.
- **Simple**: no label management, no permissions, no notification noise.

### Negative

- **No structured search**: finding issues requires `grep` or file browsing, not a query language.
- **No cross-referencing**: no automatic "closes #123" linking.
- **Collaboration friction**: external contributors must open PRs to file issues.
- **Not discoverable**: GitHub Issues is where users expect to find bug reports.

## Related

- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
