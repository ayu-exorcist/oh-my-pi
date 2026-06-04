# AI Notes

Record repeated AI failures, unexpected behaviors, and harness tweaks here.

Format:

```
## YYYY-MM-DD — <short summary>

**Failure mode:** <what went wrong>
**Context:** <task type, files involved>
**Fix:** <rule, template, or AGENTS.md change>
**Verification:** <how we know it's fixed>
```

## 2026-06-04 — explicit operation should not be blocked by clarification

**Failure mode:** The assistant treated explicit file-generation commands like `生成 test1.txt` as missing-content requests and asked for clarification instead of applying a safe default.
**Context:** Harness/prompt behavior for file-creation commands in `pi` sessions; impacted user expectations and `/rewind` checkpoint granularity.
**Fix:** Add a project rule that explicit concrete operations with safe defaults should execute without clarification; only ask when the missing detail changes the outcome or no safe default exists.
**Verification:** Re-run a held-out set of explicit file-creation prompts after the rule change and confirm empty-file defaults are applied consistently; record pass/fail and any regressions.

## Entries

### 2026-05-29 — pi-trace-lab SDK/Extension split (ADR-0002 compliance)

**Failure mode:** `pi-trace-lab` 扩展包含引擎逻辑（collector/analyzer/storage），违反 ADR-0002 分层原则。
**Context:** Architecture review against ai-engineering Ayu standards.
**Fix:**

- 新建 `sdk/pi-trace-engine/`：types, collector, analyzer, storage
- 扩展层保留：index (事件绑定), reviewer, patterns, drafter, sync, benchmark, ui
- 更新所有 import 为 `@ayulab/pi-trace-engine`
- 修复 `extractPromptFromEntry` 中的 `as` 断言 → `isRecord` 类型守卫
- ~~修复 `handleSync` 中的硬编码路径 → `AI_ENGINEERING_PATH` 环境变量优先~~ _(2026-06-02 已移除: `sync.ts` 和 `AI_ENGINEERING_PATH` 依赖已删除，所有数据统一输出到 `~/.pi/agent/ayu/`)_
- 更新 `tsconfig.json` paths, `pnpm-workspace` 自动识别
- 扩展 `tsdown.config.ts` 添加 `alwaysBundle: ["@ayulab/pi-trace-engine"]`
  **Verification:** `pnpm run check` — typecheck 0 errors, oxlint 0 errors, oxfmt clean, 383 tests passed.

### 2026-05-29 — bindSessionRepo helper + pi-trace-engine tests

**Failure mode:** `pi-rewind` 和 `pi-undo-redo` 重复实现 session repo 绑定逻辑；`pi-trace-engine` 无单元测试。
**Context:** Follow-up to SDK/Extension split.
**Fix:**

- 新增 `sdk/pi-checkpoint/src/session-repo-binder.ts`：`bindSessionRepo()` 统一封装 repo 绑定（已绑定则返回，否则 ensure/resolve + setRepo）
- `pi-rewind` session_start 使用 `bindSessionRepo` 替代 `ensureSessionCheckpointStorage`
- `pi-undo-redo` session_start 和 undo/redo handler 使用 `bindSessionRepo` 替代 `resolveSessionCheckpointStorage`
- 新增 `sdk/pi-trace-engine/src/collector.test.ts`：TurnCollector / SessionCollector 12 个测试
- 新增 `sdk/pi-trace-engine/src/analyzer.test.ts`：analyzeTurn / buildSessionSummary / formatSessionStats 11 个测试
- 更新 `vitest.config.ts` alias 添加 `@ayulab/pi-trace-engine`
  **Verification:** `pnpm run check` — typecheck 0 errors, oxlint 0 errors, oxfmt clean, 407 tests passed.

### 2026-05-29 — 空 catch 修复

**Failure mode:** `pi-trace-lab` 中 3 处空 `catch` 块隐藏错误，无法排查。
**Fix:**

- `onSessionShutdown` 中 `saveSessionTrace` 失败：改为 `catch (err)` + `ctx.ui.notify(..., "info")`
- `handleWeekly` 中周报写入失败：改为 `catch (err)` + `ctx.ui.notify(..., "warning")`
- ~~`sync.ts` 中 `appendToIndex` 的 `readFile` catch：改为 `existsSync` 预检，完全消除 catch~~ _(2026-06-02: `sync.ts` 已删除)_
  **Verification:** `pnpm run check` — 32 files, 407 tests passed.

### 2026-05-29 — Monorepo config audit & refactor

**Context:** Audit `oh-my-pi` architecture against `ai-engineering` Ayu standards.

**Changes:**

- Compressed `AGENTS.md` from ~120 to ~55 lines; long harness rules moved to `docs/agents/ai-harness.md`
- Added `docs/ARCHITECTURE.md` and `docs/TESTING.md`
- Created `.pi/ayu/tasks/backlog.md` and `.pi/ayu/tasks/ai-notes.md`
- Added `@ayulab/pi-rewind` as `peerDependency` of `pi-undo-redo`
- Unified devDependency versions via pnpm `catalog:` in `pnpm-workspace.yaml`
- Consolidated Vitest configs: deleted 5 redundant sub-package configs; kept alias-only configs for `pi-rewind` and `pi-undo-redo`
- Added `@ayulab/pi-checkpoint/testing` to `tsconfig.json` paths

**Blocker encountered:** Coverage provider migration.

- Attempted to switch root coverage from `istanbul` to `v8` with 100% thresholds.
- `v8` reports stricter branch coverage: `pi-clarify` drops to 71.59%, `pi-workflow` to 78.99%.
- Decision: keep root at `istanbul` with thresholds matching current baseline (95/89/98/96); `pi-undo-redo` retains its own `v8` + 100% config.
- Follow-up: open task to improve `pi-clarify` and `pi-workflow` branch coverage before migrating root to `v8` + 100%.

**Verification:** `pnpm run ci` — typecheck 0 errors, oxlint 0 errors, oxfmt clean, 314 tests passed.
