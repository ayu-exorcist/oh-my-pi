# Permission System Extension Context

`@ayulab/pi-permission-system` is a local fork of `@gotgenes/pi-permission-system` vendored into `oh-my-pi`.

## Role

- Enforce allow / ask / deny policy for Pi tools, bash commands, MCP targets, skills, path access, and external-directory access.
- Provide session-scoped approvals and review/debug logging.
- Expose a cross-extension service via `@ayulab/pi-permission-system`.

## Ayu Layout

- Global config: `~/.pi/agent/ayu/extensions/pi-permission-system/config.json`
- Project config: `<cwd>/.pi/ayu/extensions/pi-permission-system/config.json`
- Project agent overrides: `<cwd>/.pi/ayu/agents/<agent>.md`

Pre-Ayu project config at `<cwd>/.pi/extensions/pi-permission-system/config.json` is treated as a legacy fallback and should be migrated to `.pi/ayu/`.

## Capability Registry Note

- Source: vendored from `@gotgenes/pi-permission-system@7.4.1`.
- Local package: `@ayulab/pi-permission-system@0.1.0`.
- Manifest hash: `sha256:c7c1ea28ca6c23c2f95d64aa2b3a583beb61d966e50b29137efeb579be4be38f` for `package.json`.
- Auth scopes: no external auth scopes.
- Highest side-effect tier: T4 capability influence because policy can allow or deny privileged Pi tool execution.
- Sandbox profile: privileged Pi extension runtime.

## Safety Notes

- Extension code is privileged runtime harness code.
- Do not weaken deny/ask behavior or path/external-directory gates without explicit approval and regression tests.
- Preserve compatibility for the cross-extension service accessor unless changing the public API intentionally.
