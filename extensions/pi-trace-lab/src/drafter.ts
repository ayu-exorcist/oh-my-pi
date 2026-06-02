/**
 * IterationDrafter — Generate harness iteration card markdown from a Pattern.
 *
 * Uses the pattern's source reviews to build a before/after narrative.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Pattern, SessionReview, SessionTrace } from "@ayulab/pi-trace-engine";
import { StorageManager } from "@ayulab/pi-trace-engine";

export async function draftIterationCard(
  ctx: ExtensionContext,
  pattern: Pattern,
  storage: StorageManager,
): Promise<string | null> {
  // Load source reviews and traces for context
  const reviews: SessionReview[] = [];
  const traces: SessionTrace[] = [];

  for (const sessionId of pattern.sourceSessions) {
    const review = await storage.loadReview(sessionId);
    const trace = await storage.loadSessionTrace(sessionId);
    if (review) reviews.push(review);
    if (trace) traces.push(trace);
  }

  const card = buildIterationCardMarkdown(pattern, reviews, traces);
  const cardPath = await storage.saveIterationCard(pattern.id, card);

  return cardPath;
}

function buildIterationCardMarkdown(
  pattern: Pattern,
  reviews: SessionReview[],
  traces: SessionTrace[],
): string {
  const now = new Date().toISOString().split("T")[0];
  const avgToolCalls =
    traces.length > 0
      ? Math.round(traces.reduce((s, t) => s + t.summary.totalToolCalls, 0) / traces.length)
      : 0;

  const reviewQuotes = reviews
    .filter((r) => r.harnessImprovement)
    .map((r) => `> ${r.harnessImprovement}`)
    .join("\n>\n");

  const failureLayerCheckboxes = [
    "environment_contract",
    "procedural_skill",
    "action_realization",
    "trajectory_regulation",
    "observation",
  ]
    .map((layer) => {
      const checked = pattern.harnessLayer === layer ? "x" : " ";
      const labelMap: Record<string, string> = {
        environment_contract: "环境契约 — AGENTS/docs/规则不清",
        procedural_skill: "过程技能 — task card/workflow/模板缺失",
        action_realization: "动作实现 — 命令/验证/格式错误",
        trajectory_regulation: "轨迹调控 — 重复试错/范围失控/未停止",
        observation: "观测不足 — trace/复盘/记录不够",
      };
      return `- [${checked}] ${labelMap[layer] ?? layer}`;
    })
    .join("\n");

  return `---
id: ${pattern.id}
name: ${pattern.name}
harness_layer: ${pattern.harnessLayer}
status: draft
source: oh-my-pi
frequency: ${pattern.frequency}
source_sessions:
${pattern.sourceSessions.map((s) => `  - ${s}`).join("\n")}
created: ${now}
---

# Harness Iteration Card: ${pattern.name}

## 触发来源
- [ ] 真实任务失败
- [ ] Weekly review
- [ ] Benchmark regression
- [ ] Review 返工
- [ ] 成本/耗时异常

## 证据
- **Frequency**: ${pattern.frequency} sessions
- **Avg tool calls per affected session**: ${avgToolCalls}
- **Source sessions**: ${pattern.sourceSessions.length}

### Reviewer quotes
${reviewQuotes || "_No detailed improvement suggestions yet._"}

## 失败归类
${failureLayerCheckboxes}

## 拟议改动
- **修改位置**: _待填写_
- **最小改动**: _待填写_
- **编辑类型**: bounded add / delete / replace / full rewrite
- **Rejected variants**: _none_
- **Negative transfer 检查**: _待填写_
- **非目标**: _这次明确不做什么_

## 经验状态
- [ ] recorded：只记录事实/失败
- [ ] understood：已归类到 harness/capability 问题
- [ ] practiced：已有训练任务
- [ ] passed：训练任务通过
- [ ] generalized：held-out/transfer 不回退
- [ ] promoted：允许进入长期规则/模板/skill

## 预期改善
| 指标 | Baseline | 预期变化 |
|---|---|---:|
| Solve rate | _待测量_ | _上升_ |
| 一次验证通过率 | _待测量_ | _上升_ |
| 人工介入次数/任务 | _待测量_ | _下降_ |
| Token/时间/成本 | _待测量_ | _不失控_ |
| pass^k / Pass^3 Lite | _待测量_ | _上升_ |

## Verification Plan
1. **Before benchmark**: 记录当前受影响任务的指标
2. **Apply change**: 实施最小 harness 改动
3. **After benchmark**: 用相同任务集重新测量
4. **Held-out check**: 确保没有 regression

## Promote / Revert 标准
- [ ] Held-out solve rate 不下降
- [ ] 目标指标达到预设改善阈值
- [ ] 没有安全/测试弱化/API 破坏 regression
- [ ] 关键 failure mode 不增加
- [ ] 有 benchmark run report 和 trace 摘要
- [ ] Human review passed 或明确 not_required

## 结果
- [ ] Promote
- [ ] Revert
- [ ] Keep as experiment

## 结论
_为什么做出这个决策_

## Notes
- Status: **draft** → 需要填写 Proposed Change 和 Verification Plan
- 填写完成后运行 \`/trace-lab verify ${pattern.id}\` 更新状态
`;
}
