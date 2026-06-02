/**
 * TurnCollector + SessionCollector — Real-time trace accumulation.
 *
 * TurnCollector  tracks a single Turn (tool calls, file ops, commands).
 * SessionCollector aggregates Turns and produces a SessionTrace on shutdown.
 */

import type {
  ToolCallEvent,
  TurnTrace,
  SessionTrace,
  ToolCallSummary,
  CommandSummary,
} from "./types";
import { analyzeTurn, buildSessionSummary } from "./analyzer";

// ─── Helpers ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function summarizeToolCall(toolName: string, input: unknown): string {
  if (toolName === "read") {
    return `read:${getStringField(input, "path") ?? getStringField(input, "file_path") ?? "?"}`;
  }
  if (toolName === "edit") {
    return `edit:${getStringField(input, "path") ?? getStringField(input, "file_path") ?? "?"}`;
  }
  if (toolName === "write") {
    return `write:${getStringField(input, "path") ?? getStringField(input, "file_path") ?? "?"}`;
  }
  if (toolName === "bash") {
    const cmd = getStringField(input, "command") ?? "";
    return `bash:${cmd.slice(0, 60)}${cmd.length > 60 ? "…" : ""}`;
  }
  return `${toolName}:…`;
}

function extractPathFromTool(toolName: string, input: unknown): string | null {
  if (toolName === "read" || toolName === "edit" || toolName === "write") {
    return getStringField(input, "path") ?? getStringField(input, "file_path") ?? null;
  }
  return null;
}

function isVerificationCommand(command: string): boolean {
  const verificationPatterns = [
    /\b(test|spec)\b/i,
    /\b(lint|eslint|oxlint)\b/i,
    /\b(typecheck|tsc)\b/i,
    /\b(build|ci|check)\b/i,
    /\b(coverage|fmt:check)\b/i,
  ];
  return verificationPatterns.some((p) => p.test(command));
}

// ─── TurnCollector ──────────────────────────────────────────────────────────

export class TurnCollector {
  turnIndex: number;
  userPrompt: string;
  toolCalls: ToolCallSummary[] = [];
  filesRead: string[] = [];
  filesWritten: string[] = [];
  filesEdited: string[] = [];
  commandsRun: CommandSummary[] = [];
  startTime: number;
  endTime = 0;

  constructor(turnIndex: number, userPrompt: string) {
    this.turnIndex = turnIndex;
    this.userPrompt = userPrompt;
    this.startTime = Date.now();
  }

  recordToolCall(event: ToolCallEvent): void {
    const summary = summarizeToolCall(event.toolName, event.input);
    this.toolCalls.push({
      toolName: event.toolName,
      inputSummary: summary,
      timestamp: Date.now(),
    });

    const filePath = extractPathFromTool(event.toolName, event.input);
    if (filePath) {
      if (event.toolName === "read") {
        this.filesRead.push(filePath);
      } else if (event.toolName === "write") {
        this.filesWritten.push(filePath);
      } else if (event.toolName === "edit") {
        this.filesEdited.push(filePath);
      }
    }

    if (event.toolName === "bash") {
      const command = getStringField(event.input, "command") ?? "";
      this.commandsRun.push({
        command,
        isVerification: isVerificationCommand(command),
      });
    }
  }

  finalize(): TurnTrace {
    this.endTime = Date.now();
    const failureSignals = analyzeTurn(this);

    return {
      turnIndex: this.turnIndex,
      userPrompt: this.userPrompt,
      toolCalls: this.toolCalls,
      filesRead: [...new Set(this.filesRead)],
      filesWritten: [...new Set(this.filesWritten)],
      filesEdited: [...new Set(this.filesEdited)],
      commandsRun: this.commandsRun,
      failureSignals,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }
}

// ─── SessionCollector ───────────────────────────────────────────────────────

export class SessionCollector {
  sessionId: string;
  cwd: string;
  startTime: number;
  endTime: number | null = null;
  turns: TurnTrace[] = [];
  private currentTurn: TurnCollector | null = null;
  private turnCounter = 0;

  constructor(sessionId: string, cwd: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.startTime = Date.now();
  }

  startTurn(userPrompt: string): void {
    this.turnCounter += 1;
    this.currentTurn = new TurnCollector(this.turnCounter, userPrompt);
  }

  getCurrentTurn(): TurnCollector | null {
    return this.currentTurn;
  }

  recordToolCall(event: ToolCallEvent): void {
    this.currentTurn?.recordToolCall(event);
  }

  endTurn(): TurnTrace | null {
    if (!this.currentTurn) return null;
    const turn = this.currentTurn.finalize();
    this.turns.push(turn);
    this.currentTurn = null;
    return turn;
  }

  finalize(): SessionTrace {
    this.endTime = Date.now();
    // End any dangling turn
    if (this.currentTurn) {
      this.turns.push(this.currentTurn.finalize());
      this.currentTurn = null;
    }

    return {
      sessionId: this.sessionId,
      cwd: this.cwd,
      startTime: this.startTime,
      endTime: this.endTime,
      turns: this.turns,
      summary: buildSessionSummary(this.turns),
    };
  }
}
