# Architecture

## Overview

`@ayulab/oh-my-pi` is a Pi package monorepo organized into three layers:

```
┌─────────────────────────────────────────┐
│  Content (skills, prompts, themes)      │  ← No runtime code; loaded by Pi
├─────────────────────────────────────────┤
│  Extensions                             │  ← Pi event handlers and commands
│  pi-clarify   pi-rewind   pi-undo-redo  │
│  pi-workflow  pi-trace-lab              │
├─────────────────────────────────────────┤
│  SDK                                    │  ← Reusable engine; zero deps
│  pi-checkpoint (git bare-repo engine)   │
│  pi-trace-engine (trace analysis)       │
└─────────────────────────────────────────┘
```

## Layer Responsibilities

| Layer                              | Role                                                                      | Publish Target            |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| `sdk/`                             | Reusable engines with no external dependencies. Expose seams for testing. | npm as normal library     |
| `extensions/`                      | Pi-specific event bindings, commands, and UI. Consume SDKs.               | npm as Pi package         |
| `skills/` / `prompts/` / `themes/` | Static content loaded by Pi at runtime.                                   | Bundled with root package |

## Data Flow: Checkpoint Lifecycle

The checkpoint system is the most complex cross-layer flow:

```
Pi Runtime
   │ turn_start
   ▼
pi-rewind ──▶ AutoCheckpointProducer ──▶ RepoManager.add() ──▶ git bare repo
   │ turn_end
   ▼
pi-rewind ──▶ AutoCheckpointProducer ──▶ RepoManager.commit() ──▶ git bare repo
   │ appendEntry("pi-checkpoint", entry)
   ▼
Session Entries (CheckpointEntry with beforeCommit + afterCommit)
   │
   ├──▶ pi-undo-redo reads entries ──▶ checkout beforeCommit
   └──▶ pi-rewind /rewind reads entries ──▶ checkout beforeCommit
```

## Extension Dependencies

```
pi-checkpoint (SDK)
  ▲
  ├── pi-rewind      ──▶ creates CheckpointEntry on each turn
  ├── pi-undo-redo   ──▶ consumes CheckpointEntry (peer: pi-rewind)
  └── (future extensions)

pi-trace-engine (SDK)
  ▲
  └── pi-trace-lab   ──▶ trace collector, reviewer, pattern cluster

pi-clarify           ──▶ independent; ask_user wrapper
pi-workflow          ──▶ independent; prompt router
```

## Key Design Decisions

- **SDK / Extension split** (ADR-0002): Engines live in `sdk/` so future extensions can reuse them without pulling in unrelated commands.
- **RepoProvider seam**: `RepoManager` is backed by a `RepoProvider` interface. Production uses a Map-backed filesystem provider; tests inject mock repos without temp directories.
- **Before/After commit pairs** (ADR-0003): Each checkpoint stores two commit hashes (`beforeCommit`, `afterCommit`) to support undo, redo, and dirty-guard.
- **Git bare repo with external work tree** (ADR-0001): Each session gets an isolated bare repo under `~/.pi/agent/ayu/checkpoints/sessions/`, avoiding collision with the user's own `.git`.
