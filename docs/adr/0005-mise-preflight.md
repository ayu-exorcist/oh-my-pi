# ADR-0005: Mise as Required Toolchain Preflight

## Status

Accepted

## Context

`oh-my-pi` uses a specific toolchain: pnpm, Node.js >= 20, oxfmt, oxlint, vitest. Version mismatches between contributors (or between an agent's assumptions and the actual environment) cause subtle failures — tests pass locally but fail in CI, or formatting drifts between runs.

`mise.toml` at the repo root declares the required toolchain. The question is: should the agent enforce this before doing any work?

Options considered:

1. **Implicit trust** — Assume mise is installed. Fail later with confusing errors if it is not.
2. **Preflight check with stop** — Verify `mise --version` before any operation. If missing, stop and tell the user.
3. **Preflight check with auto-install** — Verify mise. If missing, ask user consent, then run the official installer.

## Decision

Implement **option 2: preflight check with stop**.

The agent must run `mise --version` before any development work. If it fails, the agent stops all operations and informs the user. No auto-installation, no workarounds. The user must install and activate mise themselves.

This rule is encoded in `AGENTS.md` under the "Toolchain preflight" section.

We explicitly rejected auto-installation because:

- It modifies the user's system without clear consent boundaries.
- Shell activation (`~/.bashrc`, `~/.zshrc`) requires knowledge of the user's shell that the agent may not have.
- A failed or partial installation leaves the system in an unknown state.

## Consequences

### Positive

- **Consistent toolchain**: every agent session starts from a known-good environment.
- **Early failure**: mise absence is caught immediately, not halfway through a refactor.
- **Minimal invasiveness**: the agent never modifies the user's system.

### Negative

- **Friction for new contributors**: they must install mise before the agent can help them.
- **Assumes mise is the source of truth**: if a contributor uses nvm, fnm, or asdf instead, they still need mise installed even if their toolchain is functionally equivalent.

## Related

- `AGENTS.md`
- `mise.toml`
