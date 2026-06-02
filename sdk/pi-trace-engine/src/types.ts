/**
 * Trace Lab — Core type definitions for session trace, review, pattern, and iteration.
 */

// ─── Tool & Command Summaries ───────────────────────────────────────────────

export interface ToolCallSummary {
  toolName: string;
  inputSummary: string;
  timestamp: number;
}

export interface CommandSummary {
  command: string;
  isVerification: boolean;
}

// ─── Failure Signals ────────────────────────────────────────────────────────

export type FailureSignalType =
  | "error_loop"
  | "scope_creep"
  | "high_retry"
  | "repeated_read"
  | "verification_heuristic";

export interface FailureSignal {
  type: FailureSignalType;
  description: string;
  severity: "info" | "warning" | "critical";
  turnIndex: number;
}

// ─── Turn Trace ─────────────────────────────────────────────────────────────

export interface TurnTrace {
  turnIndex: number;
  userPrompt: string;
  toolCalls: ToolCallSummary[];
  filesRead: string[];
  filesWritten: string[];
  filesEdited: string[];
  commandsRun: CommandSummary[];
  failureSignals: FailureSignal[];
  startTime: number;
  endTime: number;
}

// ─── Session Summary ────────────────────────────────────────────────────────

export interface SessionSummary {
  totalToolCalls: number;
  totalFilesRead: number;
  totalFilesWritten: number;
  totalCommandsRun: number;
  failureCount: number;
  errorLoopDetected: boolean;
  scopeCreepDetected: boolean;
  highRetryDetected: boolean;
  verificationHeuristic: boolean;
}

// ─── Session Trace ──────────────────────────────────────────────────────────

export interface SessionTrace {
  sessionId: string;
  cwd: string;
  startTime: number;
  endTime: number | null;
  turns: TurnTrace[];
  summary: SessionSummary;
}

// ─── Session Review ─────────────────────────────────────────────────────────

export type ReviewOutcome = "success" | "partial" | "failure";

export type FailureLayer =
  | "environment_contract"
  | "procedural_skill"
  | "action_realization"
  | "trajectory_regulation"
  | "observation"
  | null;

export interface SessionReview {
  sessionId: string;
  reviewedAt: string;
  outcome: ReviewOutcome;
  failureLayer: FailureLayer;
  harnessImprovement: string | null;
  shouldIterate: boolean;
  iterationIdea: string | null;
  reviewerNotes: string;
}

// ─── Pattern ────────────────────────────────────────────────────────────────

export type PatternStatus = "observed" | "drafting" | "iterating" | "verified" | "rejected";

export interface Pattern {
  id: string;
  name: string;
  description: string;
  harnessLayer: string;
  frequency: number;
  sourceSessions: string[];
  status: PatternStatus;
  iterationCardPath: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Wizard Question ────────────────────────────────────────────────────────

export interface WizardQuestion {
  key: string;
  message: string;
  type: "select" | "text";
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

// ─── Pi Event Type Augmentations (local shims until full types are available) ─

export interface ToolCallEvent {
  toolName: string;
  input: unknown;
}

export interface TurnStartEvent {
  // Pi does not expose rich turn_start payload in current API surface
}

export interface TurnEndEvent {
  // Pi does not expose rich turn_end payload in current API surface
}

export interface SessionShutdownEvent {
  reason: string;
  targetSessionFile?: string;
  previousSessionFile?: string;
}
