---
name: capability-guard
description: MCP, A2A, skill, plugin, and browser capability registry rules. Use when adding, modifying, or reviewing external capabilities, MCP servers, or agent-to-agent integrations.
---

# Capability Guard

## When to use

- Adding or modifying an MCP server, A2A agent, skill, plugin, hook, or browser/sandbox capability.
- Reviewing the security or trust posture of an external capability.
- A capability version, schema, or auth scope changes.

## Rules

### Registry entry

Before adding a capability, record:

- Source, version/ref/sha, manifest hash.
- Auth scopes, highest T0-T4 tier, sandbox profile.

### Scope boundary

- MCP/A2A/Skill only solves connection, declaration, or workflow wrapping.
- It does not replace permission, audit, sandbox, testing, or confirmation.

### Supply chain review

- Review local MCP server / plugin / skill scripts as supply chain artifacts.
- Do not blindly trust `allowed-tools`, hooks, or startup commands.

### Baseline on change

- Capability version, tool schema, Agent Card, SKILL.md, plugin manifest, or auth scope changes require rebuilding the benchmark baseline.

### Promotion gate

- Before promotion, capability must have review evidence, sandbox/smoke test, trace/audit fields, and evolve/held-out benchmark coverage.
- On failure or anomaly, mark as quarantined.
