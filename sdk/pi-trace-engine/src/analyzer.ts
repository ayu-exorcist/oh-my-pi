/**
 * Analyzer — Detect failure signals in a single Turn and build SessionSummary.
 *
 * All heuristics are conservative:宁可漏报也不误报，避免让用户对信号脱敏。
 */

import type { TurnTrace, SessionSummary, FailureSignal } from "./types";
import type { TurnCollector } from "./collector";

const ERROR_LOOP_THRESHOLD = 2;
const HIGH_RETRY_THRESHOLD = 30;
const SCOPE_CREEP_FILE_THRESHOLD = 5;
const REPEATED_READ_THRESHOLD = 3;

// ─── Turn-Level Analysis ────────────────────────────────────────────────────

export function analyzeTurn(collector: TurnCollector): FailureSignal[] {
  const signals: FailureSignal[] = [];

  signals.push(...detectErrorLoop(collector));
  signals.push(...detectHighRetry(collector));
  signals.push(...detectScopeCreep(collector));
  signals.push(...detectRepeatedRead(collector));
  signals.push(...detectVerificationHeuristic(collector));

  return signals;
}

function detectErrorLoop(collector: TurnCollector): FailureSignal[] {
  const bashCommands = collector.commandsRun.map((c) => c.command);
  const commandCounts = new Map<string, number>();

  for (const cmd of bashCommands) {
    // Normalize: strip trailing args differences to catch "pnpm test" retries
    const normalized = cmd.split(/\s+/).slice(0, 4).join(" ");
    commandCounts.set(normalized, (commandCounts.get(normalized) ?? 0) + 1);
  }

  const signals: FailureSignal[] = [];
  for (const [normalized, count] of commandCounts) {
    if (count >= ERROR_LOOP_THRESHOLD) {
      signals.push({
        type: "error_loop",
        description: `Command "${normalized}" executed ${count} times — likely retrying after failure`,
        severity: count >= 4 ? "critical" : "warning",
        turnIndex: collector.turnIndex,
      });
    }
  }

  return signals;
}

function detectHighRetry(collector: TurnCollector): FailureSignal[] {
  if (collector.toolCalls.length < HIGH_RETRY_THRESHOLD) return [];

  return [
    {
      type: "high_retry",
      description: `${collector.toolCalls.length} tool calls in one turn — possible repeated_error_loop or unnecessary exploration`,
      severity: collector.toolCalls.length > 50 ? "critical" : "warning",
      turnIndex: collector.turnIndex,
    },
  ];
}

function detectScopeCreep(collector: TurnCollector): FailureSignal[] {
  const allModified = new Set([...collector.filesWritten, ...collector.filesEdited]);
  if (allModified.size < SCOPE_CREEP_FILE_THRESHOLD) return [];

  return [
    {
      type: "scope_creep",
      description: `${allModified.size} distinct files modified in one turn — possible scope creep`,
      severity: allModified.size > 10 ? "critical" : "warning",
      turnIndex: collector.turnIndex,
    },
  ];
}

function detectRepeatedRead(collector: TurnCollector): FailureSignal[] {
  const readCounts = new Map<string, number>();
  for (const f of collector.filesRead) {
    readCounts.set(f, (readCounts.get(f) ?? 0) + 1);
  }

  const signals: FailureSignal[] = [];
  for (const [file, count] of readCounts) {
    if (count >= REPEATED_READ_THRESHOLD) {
      signals.push({
        type: "repeated_read",
        description: `File "${file}" read ${count} times in one turn — possible confusion or missing context`,
        severity: "info",
        turnIndex: collector.turnIndex,
      });
    }
  }

  return signals;
}

function detectVerificationHeuristic(collector: TurnCollector): FailureSignal[] {
  // Heuristic: if verification commands exist but the turn has many tool calls without
  // a final verification-looking command near the end, flag it.
  const verificationCommands = collector.commandsRun.filter((c) => c.isVerification);
  if (verificationCommands.length === 0) return [];

  // If verification commands were run early but not near the end, and there are
  // many subsequent tool calls, it may indicate verification was skipped.
  const totalCommands = collector.commandsRun.length;
  let lastVerificationIndex = -1;
  for (let i = collector.commandsRun.length - 1; i >= 0; i--) {
    if (collector.commandsRun[i]?.isVerification) {
      lastVerificationIndex = i;
      break;
    }
  }

  if (lastVerificationIndex >= 0 && totalCommands - lastVerificationIndex > 5) {
    return [
      {
        type: "verification_heuristic",
        description:
          "Verification command ran early but many subsequent tool calls without re-verification — possible skipped check",
        severity: "info",
        turnIndex: collector.turnIndex,
      },
    ];
  }

  return [];
}

// ─── Session-Level Summary ──────────────────────────────────────────────────

export function buildSessionSummary(turns: TurnTrace[]): SessionSummary {
  const allSignals = turns.flatMap((t) => t.failureSignals);

  return {
    totalToolCalls: turns.reduce((sum, t) => sum + t.toolCalls.length, 0),
    totalFilesRead: turns.reduce((sum, t) => sum + t.filesRead.length, 0),
    totalFilesWritten: turns.reduce((sum, t) => sum + t.filesWritten.length, 0),
    totalCommandsRun: turns.reduce((sum, t) => sum + t.commandsRun.length, 0),
    failureCount: allSignals.filter((s) => s.severity !== "info").length,
    errorLoopDetected: allSignals.some((s) => s.type === "error_loop"),
    scopeCreepDetected: allSignals.some((s) => s.type === "scope_creep"),
    highRetryDetected: allSignals.some((s) => s.type === "high_retry"),
    verificationHeuristic: allSignals.some((s) => s.type === "verification_heuristic"),
  };
}

// ─── Utility: Format session stats for display ───────────────────────────────

export function formatSessionStats(trace: { turns: TurnTrace[]; summary: SessionSummary }): string {
  const s = trace.summary;
  const lines = [
    `Turns: ${trace.turns.length}`,
    `Tool calls: ${s.totalToolCalls}`,
    `Files read: ${s.totalFilesRead}`,
    `Files written: ${s.totalFilesWritten}`,
    `Commands: ${s.totalCommandsRun}`,
  ];

  const warnings = trace.turns.flatMap((t) => t.failureSignals);
  if (warnings.length > 0) {
    lines.push("", "Signals:");
    for (const w of warnings) {
      const icon = w.severity === "critical" ? "🔴" : w.severity === "warning" ? "🟡" : "🔵";
      lines.push(`  ${icon} [T${w.turnIndex}] ${w.type}: ${w.description}`);
    }
  }

  return lines.join("\n");
}
