/**
 * pi-trace-lab — Pi Extension for AI Engineering Self-Iteration
 *
 * Architecture:
 *   Pi Events → Collector → Analyzer → Storage
 *   Commands  → Reviewer / PatternCluster / Drafter / Sync
 *
 * Data layout (under ~/.pi/agent/ayu/trace-lab/<project>/):
 *   sessions/   <session-id>.json
 *   reviews/    <session-id>.md
 *   patterns/   patterns.json
 *   iterations/ ITER-<pattern-id>.md
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  ToolCallEvent,
  TurnStartEvent,
  TurnEndEvent,
  SessionShutdownEvent,
} from "@ayulab/pi-trace-engine";
import { StorageManager, SessionCollector, formatSessionStats } from "@ayulab/pi-trace-engine";
import { SessionStateMap } from "@ayulab/pi-checkpoint";
import { runSessionReview } from "./reviewer";
import { clusterPatterns, confirmPatterns } from "./patterns";
import { draftIterationCard } from "./drafter";

// ─── Per-session state (isolated by sessionId / cwd) ────────────────────────

const collectors = new SessionStateMap<SessionCollector>();
const storages = new Map<string, StorageManager>();
const reviewPending = new SessionStateMap<boolean>();

function getStorage(cwd: string): StorageManager {
  let s = storages.get(cwd);
  if (!s) {
    s = new StorageManager(cwd);
    storages.set(cwd, s);
  }
  return s;
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

function onSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): void {
  const sessionId = ctx.sessionManager.getSessionId();
  const cwd = ctx.cwd;

  reviewPending.set(sessionId, false);

  getStorage(cwd)
    .ensureDirs()
    .catch(() => {});

  const collector = new SessionCollector(sessionId, cwd);
  collectors.set(sessionId, collector);

  // If resuming a forked session, the collector state is fresh (acceptable limitation).
}

function onTurnStart(_event: TurnStartEvent, ctx: ExtensionContext): void {
  const sessionId = ctx.sessionManager.getSessionId();
  const collector = collectors.getOrUndefined(sessionId);
  if (!collector) return;

  // Try to extract the latest user prompt from session entries
  const branch = ctx.sessionManager.getBranch();
  const lastUser = branch[branch.length - 1];
  const prompt = extractPromptFromEntry(lastUser) || "(unknown prompt)";

  collector.startTurn(prompt);
}

function onToolCall(event: ToolCallEvent, ctx: ExtensionContext): void {
  const sessionId = ctx.sessionManager.getSessionId();
  const collector = collectors.getOrUndefined(sessionId);
  if (!collector) return;

  collector.recordToolCall(event);

  // Real-time anomaly notification
  const currentTurn = collector.getCurrentTurn();
  if (currentTurn && currentTurn.toolCalls.length > 30) {
    if (ctx.hasUI && !reviewPending.getOrUndefined(sessionId)) {
      ctx.ui.notify(
        "Trace Lab: High retry detected (>30 tool calls). Consider /trace-lab review after this task.",
        "warning",
      );
      reviewPending.set(sessionId, true);
    }
  }
}

function onTurnEnd(_event: TurnEndEvent, ctx: ExtensionContext): void {
  const sessionId = ctx.sessionManager.getSessionId();
  const collector = collectors.getOrUndefined(sessionId);
  if (!collector) return;

  const turn = collector.endTurn();
  if (!turn) return;

  // Notify on critical signals
  const critical = turn.failureSignals.filter((s) => s.severity === "critical");
  const warnings = turn.failureSignals.filter((s) => s.severity === "warning");

  if (critical.length > 0 && ctx.hasUI) {
    ctx.ui.notify(
      `Trace Lab: 🚨 ${critical.length} critical signal(s) in Turn ${turn.turnIndex}. Run /trace-lab review soon.`,
      "error",
    );
  } else if (warnings.length > 0 && ctx.hasUI && !reviewPending.getOrUndefined(sessionId)) {
    ctx.ui.notify(
      `Trace Lab: ⚠️ ${warnings.length} warning(s) in Turn ${turn.turnIndex}. Consider /trace-lab review.`,
      "warning",
    );
    reviewPending.set(sessionId, true);
  }
}

async function onSessionShutdown(
  _event: SessionShutdownEvent,
  ctx: ExtensionContext,
): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();
  const collector = collectors.getOrUndefined(sessionId);
  if (!collector) return;

  const trace = collector.finalize();
  collectors.delete(sessionId);
  reviewPending.delete(sessionId);

  try {
    await getStorage(ctx.cwd).saveSessionTrace(trace);
  } catch (err) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Trace Lab: Failed to save session trace: ${err instanceof Error ? err.message : String(err)}`,
        "info",
      );
    }
  }

  // Final notification with summary
  if (ctx.hasUI) {
    const summary = formatSessionStats(trace);
    const hasIssues =
      trace.summary.errorLoopDetected ||
      trace.summary.scopeCreepDetected ||
      trace.summary.highRetryDetected;

    if (hasIssues) {
      ctx.ui.notify(
        `Trace Lab: Session saved.\n${summary}\n\nRun /trace-lab review to analyze.`,
        "warning",
      );
    } else {
      ctx.ui.notify(`Trace Lab: Session saved cleanly.\n${summary}`, "info");
    }
  }
}

// ─── Prompt Extraction ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPromptFromEntry(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;

  // User message entry
  if (entry.type === "user" && typeof entry.content === "string") {
    return entry.content.slice(0, 200);
  }

  // Tool result entry (skip)
  if (entry.type === "tool_result") return undefined;

  // Fallback: any content field
  if (typeof entry.content === "string") {
    return entry.content.slice(0, 200);
  }

  return undefined;
}

// ─── Command Router ─────────────────────────────────────────────────────────

async function handleTraceLabCommand(args: string, ctx: ExtensionContext): Promise<void> {
  const trimmed = args.trim();
  const parts = trimmed.split(/\s+/);
  const subcommand = parts[0] ?? "";

  switch (subcommand) {
    case "review":
      await handleReview(ctx);
      break;
    case "weekly":
      await handleWeekly(ctx);
      break;
    case "draft":
      await handleDraft(parts.slice(1).join(" "), ctx);
      break;
    case "patterns":
      await handlePatterns(ctx);
      break;
    case "status":
      await handleStatus(ctx);
      break;
    case "verify":
      await handleVerify(parts.slice(1).join(" "), ctx);
      break;
    case "help":
    default:
      ctx.ui.notify(buildHelpText(), "info");
      break;
  }
}

// ─── Subcommand Handlers ────────────────────────────────────────────────────

async function handleReview(ctx: ExtensionContext): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();

  const trace = await getStorage(ctx.cwd).loadSessionTrace(sessionId);
  if (!trace) {
    ctx.ui.notify(
      "Trace Lab: No trace found for this session. Wait for session to end.",
      "warning",
    );
    return;
  }

  const review = await runSessionReview(ctx, trace);
  if (!review) return;

  await getStorage(ctx.cwd).saveReview(review);
  ctx.ui.notify(
    `Trace Lab: Review saved.\nOutcome: ${review.outcome} | Iterate: ${review.shouldIterate ? "yes" : "no"}`,
    review.outcome === "success" ? "info" : "warning",
  );
}

async function handleWeekly(ctx: ExtensionContext): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const traces = await getStorage(ctx.cwd).listSessionTraces(since);
  const reviews = (await getStorage(ctx.cwd).loadAllReviews()).filter(
    (r) => new Date(r.reviewedAt) >= since,
  );
  const existingPatterns = await getStorage(ctx.cwd).loadPatterns();

  if (reviews.length === 0) {
    ctx.ui.notify(
      "Trace Lab: No reviews found in the last 7 days. Run /trace-lab review after sessions first.",
      "info",
    );
    return;
  }

  const { patterns, report } = await clusterPatterns(reviews, existingPatterns);

  // Save weekly report
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const reportPath = path.join(
    getStorage(ctx.cwd).getBaseDir(),
    "patterns",
    `weekly-${getWeekKey()}.md`,
  );
  try {
    await getStorage(ctx.cwd).ensureDirs();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, report, "utf8");
  } catch (err) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Trace Lab: Failed to save weekly report: ${err instanceof Error ? err.message : String(err)}`,
        "warning",
      );
    }
  }

  // Interactive confirmation
  const confirmedPatterns = await confirmPatterns(ctx, patterns);
  await getStorage(ctx.cwd).savePatterns(confirmedPatterns);

  ctx.ui.notify(
    `Trace Lab: Weekly report generated.\nSessions: ${traces.length} | Reviews: ${reviews.length} | Patterns: ${confirmedPatterns.filter((p) => p.status === "drafting").length} drafting`,
    "info",
  );
}

async function handleDraft(patternIdArg: string, ctx: ExtensionContext): Promise<void> {
  const patternId = patternIdArg.trim();
  if (!patternId) {
    ctx.ui.notify("Usage: /trace-lab draft <pattern-id>", "warning");
    return;
  }

  const patterns = await getStorage(ctx.cwd).loadPatterns();
  const pattern = patterns.find((p) => p.id === patternId);

  if (!pattern) {
    ctx.ui.notify(
      `Trace Lab: Pattern '${patternId}' not found. Run /trace-lab patterns to list.`,
      "warning",
    );
    return;
  }

  const cardPath = await draftIterationCard(ctx, pattern, getStorage(ctx.cwd));
  if (cardPath) {
    pattern.iterationCardPath = cardPath;
    pattern.status = "iterating";
    await getStorage(ctx.cwd).savePatterns(patterns);
    ctx.ui.notify(`Trace Lab: Iteration card drafted: ${cardPath}`, "info");
  }
}

async function handlePatterns(ctx: ExtensionContext): Promise<void> {
  const patterns = await getStorage(ctx.cwd).loadPatterns();

  if (patterns.length === 0) {
    ctx.ui.notify("Trace Lab: No patterns yet. Run /trace-lab weekly first.", "info");
    return;
  }

  const lines = [
    "Trace Lab Patterns",
    "",
    ...patterns.map((p) => {
      const statusIcon =
        p.status === "verified"
          ? "✅"
          : p.status === "iterating"
            ? "🔧"
            : p.status === "drafting"
              ? "📝"
              : "👁️";
      return `${statusIcon} ${p.name} [${p.id}] — ${p.harnessLayer} (${p.frequency}次)`;
    }),
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleStatus(ctx: ExtensionContext): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();

  const trace = await getStorage(ctx.cwd).loadSessionTrace(sessionId);
  if (!trace) {
    ctx.ui.notify("Trace Lab: No trace for current session yet.", "info");
    return;
  }

  ctx.ui.notify(formatSessionStats(trace), "info");
}

async function handleVerify(patternIdArg: string, ctx: ExtensionContext): Promise<void> {
  const patternId = patternIdArg.trim();
  if (!patternId) {
    ctx.ui.notify("Usage: /trace-lab verify <pattern-id>", "warning");
    return;
  }

  const patterns = await getStorage(ctx.cwd).loadPatterns();
  const pattern = patterns.find((p) => p.id === patternId);

  if (!pattern) {
    ctx.ui.notify(`Trace Lab: Pattern '${patternId}' not found.`, "warning");
    return;
  }

  pattern.status = "iterating";
  pattern.updatedAt = new Date().toISOString();
  await getStorage(ctx.cwd).savePatterns(patterns);

  ctx.ui.notify(
    `Trace Lab: Pattern ${patternId} marked as iterating. Update the iteration card, run benchmark, then sync when verified.`,
    "info",
  );
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function buildHelpText(): string {
  return `Trace Lab — AI Engineering Self-Iteration

Trace collection (automatic):
  Session events are recorded silently

Commands:
  /trace-lab review              Review the current/latest session
  /trace-lab weekly              Cluster reviews into patterns (last 7 days)
  /trace-lab draft <pattern-id>  Generate iteration card for a pattern
  /trace-lab patterns            List all patterns
  /trace-lab status              Show current session stats
  /trace-lab verify <pattern-id> Mark pattern as iterating
  /trace-lab help                Show this help`;
}

function getWeekKey(): string {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d.getTime() - start.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  const week = Math.floor(diff / oneWeek);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─── Extension Entry Point ──────────────────────────────────────────────────

export default function traceLab(pi: ExtensionAPI) {
  pi.on("session_start", onSessionStart);
  pi.on("turn_start", onTurnStart);
  pi.on("tool_call", onToolCall);
  pi.on("turn_end", onTurnEnd);
  pi.on("session_shutdown", onSessionShutdown);

  pi.registerCommand("trace-lab", {
    description: "AI Engineering trace collection, review, pattern clustering, and harness sync",
    handler: handleTraceLabCommand,
  });
}
