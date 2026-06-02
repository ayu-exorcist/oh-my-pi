/**
 * SessionReviewer — Structured review of a single session via TUI wizard.
 *
 * Produces a SessionReview markdown file that feeds into pattern clustering.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  SessionTrace,
  SessionReview,
  FailureLayer,
  ReviewOutcome,
  WizardQuestion,
} from "@ayulab/pi-trace-engine";

const REVIEW_OUTCOMES: readonly ReviewOutcome[] = ["success", "partial", "failure"];
const FAILURE_LAYERS: readonly Exclude<FailureLayer, null>[] = [
  "environment_contract",
  "procedural_skill",
  "action_realization",
  "trajectory_regulation",
  "observation",
];

function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return typeof value === "string" && REVIEW_OUTCOMES.includes(value as ReviewOutcome);
}

function isFailureLayer(value: unknown): value is FailureLayer {
  return (
    value === null ||
    (typeof value === "string" && FAILURE_LAYERS.includes(value as Exclude<FailureLayer, null>))
  );
}
import { formatSessionStats } from "@ayulab/pi-trace-engine";
import { runWizard } from "./ui/wizard";

export async function runSessionReview(
  ctx: ExtensionContext,
  trace: SessionTrace,
): Promise<SessionReview | null> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Trace Lab: Session review requires interactive UI.", "warning");
    return null;
  }

  // Show summary first
  const stats = formatSessionStats(trace);
  ctx.ui.notify(`Trace Lab: Reviewing session ${trace.sessionId.slice(0, 8)}…\n${stats}`, "info");

  const questions = buildReviewQuestions(trace);
  const answers = await runWizard(ctx, questions);

  const outcomeAnswer = safeAnswer(answers, "outcome");
  const review: SessionReview = {
    sessionId: trace.sessionId,
    reviewedAt: new Date().toISOString(),
    outcome: isReviewOutcome(outcomeAnswer) ? outcomeAnswer : "success",
    failureLayer: parseFailureLayer(safeAnswer(answers, "failure_layer")),
    harnessImprovement: safeAnswer(answers, "harness_improvement"),
    shouldIterate: safeAnswer(answers, "should_iterate") === "yes",
    iterationIdea: safeAnswer(answers, "iteration_idea"),
    reviewerNotes: safeAnswer(answers, "reviewer_notes") ?? "",
  };

  return review;
}

function buildReviewQuestions(trace: SessionTrace): WizardQuestion[] {
  const hasWarnings = trace.turns.some((t) => t.failureSignals.some((s) => s.severity !== "info"));

  const questions: WizardQuestion[] = [
    {
      key: "outcome",
      message: "本次任务是否达成目标？",
      type: "select",
      options: [
        { value: "success", label: "✅ 成功达成" },
        { value: "partial", label: "⚠️ 部分达成" },
        { value: "failure", label: "❌ 未达成" },
      ],
      defaultValue: hasWarnings ? "partial" : "success",
    },
    {
      key: "failure_layer",
      message: "如果未完美达成，属于哪一层 harness 问题？",
      type: "select",
      options: [
        { value: "environment_contract", label: "🏗️ 环境契约 — AGENTS.md/文档/规则不清" },
        { value: "procedural_skill", label: "📋 过程技能 — task card/workflow/模板缺失" },
        { value: "action_realization", label: "⚙️ 动作实现 — check命令/验证/格式错误" },
        { value: "trajectory_regulation", label: "🛑 轨迹调控 — 重复试错/范围失控/未停止" },
        { value: "observation", label: "👁️ 观测不足 — trace/复盘/记录不够" },
        { value: "null", label: "✓ 无问题（跳过）" },
      ],
      defaultValue: hasWarnings ? "environment_contract" : "null",
    },
    {
      key: "harness_improvement",
      message: '"如果写了 X，就不会出问题" 的具体建议：',
      type: "text",
      defaultValue: "",
    },
    {
      key: "should_iterate",
      message: "这个经验是否值得写成 harness iteration card？",
      type: "select",
      options: [
        { value: "yes", label: "是 — 写成 iteration card" },
        { value: "no", label: "否 — 只是一次性情况" },
      ],
      defaultValue: hasWarnings ? "yes" : "no",
    },
  ];

  // Always ask iteration idea; the user can leave it blank if they chose "no"
  questions.push({
    key: "iteration_idea",
    message: "Iteration 的简要描述（用于 pattern 命名）：",
    type: "text",
    defaultValue: "",
  });

  questions.push({
    key: "reviewer_notes",
    message: "其他备注（可选）：",
    type: "text",
    defaultValue: "",
  });

  return questions;
}

function safeAnswer(
  answers: Record<string, string | null | undefined>,
  key: string,
): string | null {
  const val = answers[key];
  return val === undefined || val === null ? null : val;
}

function parseFailureLayer(raw: string | null): FailureLayer {
  if (!raw || raw === "null") return null;
  return isFailureLayer(raw) ? raw : null;
}
