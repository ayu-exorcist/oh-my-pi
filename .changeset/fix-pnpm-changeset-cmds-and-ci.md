---
"@ayulab/oh-my-pi": patch
---

- fix: remove `run` prefix from `pnpm changeset` commands in publish scripts (`pnpm changeset status` / `pnpm changeset publish` instead of `pnpm run changeset ...`)
- ci: add `paths` filter to `prepare-release-pr.yml` workflow to trigger only on `.changeset/*.md` changes
