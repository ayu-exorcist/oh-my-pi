import { describe, it, expect } from "vitest";
import { TurnCollector, SessionCollector } from "./collector";

describe("TurnCollector", () => {
  it("initializes with correct defaults", () => {
    const turn = new TurnCollector(1, "test prompt");
    expect(turn.turnIndex).toBe(1);
    expect(turn.userPrompt).toBe("test prompt");
    expect(turn.toolCalls).toHaveLength(0);
    expect(turn.filesRead).toHaveLength(0);
    expect(turn.filesWritten).toHaveLength(0);
    expect(turn.filesEdited).toHaveLength(0);
    expect(turn.commandsRun).toHaveLength(0);
  });

  it("records read tool calls", () => {
    const turn = new TurnCollector(1, "read file");
    turn.recordToolCall({ toolName: "read", input: { path: "src/index.ts" } });
    turn.recordToolCall({ toolName: "read", input: { file_path: "src/lib.ts" } });

    expect(turn.filesRead).toEqual(["src/index.ts", "src/lib.ts"]);
    expect(turn.toolCalls).toHaveLength(2);
  });

  it("records write tool calls", () => {
    const turn = new TurnCollector(1, "write file");
    turn.recordToolCall({ toolName: "write", input: { path: "output.txt" } });
    turn.recordToolCall({ toolName: "write", input: { file_path: "fallback.txt" } });

    expect(turn.filesWritten).toEqual(["output.txt", "fallback.txt"]);
    expect(turn.toolCalls[1]!.inputSummary).toBe("write:fallback.txt");
  });

  it("records edit tool calls", () => {
    const turn = new TurnCollector(1, "edit file");
    turn.recordToolCall({ toolName: "edit", input: { path: "src/index.ts" } });
    turn.recordToolCall({ toolName: "edit", input: { file_path: "src/fallback.ts" } });
    turn.recordToolCall({ toolName: "edit", input: {} });

    expect(turn.filesEdited).toEqual(["src/index.ts", "src/fallback.ts"]);
    expect(turn.toolCalls[1]!.inputSummary).toBe("edit:src/fallback.ts");
    expect(turn.toolCalls[2]!.inputSummary).toBe("edit:?");
  });

  it("records bash tool calls and detects verification commands", () => {
    const turn = new TurnCollector(1, "run tests");
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test" } });
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm lint" } });
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm typecheck" } });
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm build" } });
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm coverage" } });
    turn.recordToolCall({ toolName: "bash", input: { command: "echo hello" } });

    expect(turn.commandsRun).toHaveLength(6);
    expect(turn.commandsRun[0]!.isVerification).toBe(true);
    expect(turn.commandsRun[1]!.isVerification).toBe(true);
    expect(turn.commandsRun[2]!.isVerification).toBe(true);
    expect(turn.commandsRun[3]!.isVerification).toBe(true);
    expect(turn.commandsRun[4]!.isVerification).toBe(true);
    expect(turn.commandsRun[5]!.isVerification).toBe(false);
  });

  it("treats command verification heuristics conservatively", () => {
    const turn = new TurnCollector(1, "run tests");
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test --runInBand" } });
    expect(turn.commandsRun[0]!.isVerification).toBe(true);
  });

  it("records unknown tool calls", () => {
    const turn = new TurnCollector(1, "unknown tool");
    turn.recordToolCall({ toolName: "custom_tool", input: {} });

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]!.inputSummary).toBe("custom_tool:…");
    expect(turn.filesRead).toHaveLength(0);
    expect(turn.filesWritten).toHaveLength(0);
    expect(turn.filesEdited).toHaveLength(0);
  });

  it("handles read without path", () => {
    const turn = new TurnCollector(1, "read no path");
    turn.recordToolCall({ toolName: "read", input: {} });

    expect(turn.toolCalls[0]!.inputSummary).toBe("read:?");
    expect(turn.filesRead).toHaveLength(0);
  });

  it("handles bash without command field", () => {
    const turn = new TurnCollector(1, "bash no command");
    turn.recordToolCall({ toolName: "bash", input: {} });

    expect(turn.commandsRun).toHaveLength(1);
    expect(turn.commandsRun[0]!.command).toBe("");
    expect(turn.commandsRun[0]!.isVerification).toBe(false);
  });

  it("truncates long bash command summaries", () => {
    const turn = new TurnCollector(1, "bash long command");
    const command = "x".repeat(61);
    turn.recordToolCall({ toolName: "bash", input: { command } });

    expect(turn.toolCalls[0]!.inputSummary).toBe(`bash:${"x".repeat(60)}…`);
  });

  it("deduplicates files in finalize", () => {
    const turn = new TurnCollector(1, "dup reads");
    turn.recordToolCall({ toolName: "read", input: { path: "a.ts" } });
    turn.recordToolCall({ toolName: "read", input: { path: "a.ts" } });

    const trace = turn.finalize();
    expect(trace.filesRead).toEqual(["a.ts"]);
  });

  it("sets endTime on finalize", () => {
    const before = Date.now();
    const turn = new TurnCollector(1, "test");
    const trace = turn.finalize();
    const after = Date.now();

    expect(trace.endTime).toBeGreaterThanOrEqual(before);
    expect(trace.endTime).toBeLessThanOrEqual(after);
    expect(trace.startTime).toBeLessThanOrEqual(trace.endTime);
  });

  it("handles non-object input", () => {
    const turn = new TurnCollector(1, "null input");
    turn.recordToolCall({ toolName: "read", input: null });
    turn.recordToolCall({ toolName: "bash", input: undefined });
    turn.recordToolCall({ toolName: "write", input: [] });

    expect(turn.toolCalls[0]!.inputSummary).toBe("read:?");
    expect(turn.toolCalls[1]!.inputSummary).toBe("bash:");
    expect(turn.toolCalls[2]!.inputSummary).toBe("write:?");
  });
});

describe("SessionCollector", () => {
  it("aggregates multiple turns", () => {
    const session = new SessionCollector("s1", "/project");

    session.startTurn("turn 1");
    session.recordToolCall({ toolName: "read", input: { path: "a.ts" } });
    session.endTurn();

    session.startTurn("turn 2");
    session.recordToolCall({ toolName: "write", input: { path: "b.ts" } });
    session.endTurn();

    const trace = session.finalize();
    expect(trace.turns).toHaveLength(2);
    expect(trace.sessionId).toBe("s1");
    expect(trace.cwd).toBe("/project");
  });

  it("finalizes dangling turn", () => {
    const session = new SessionCollector("s1", "/project");
    session.startTurn("dangling");
    session.recordToolCall({ toolName: "read", input: { path: "a.ts" } });
    // no endTurn()

    const trace = session.finalize();
    expect(trace.turns).toHaveLength(1);
    expect(trace.turns[0]!.userPrompt).toBe("dangling");
  });

  it("returns null from endTurn when no current turn", () => {
    const session = new SessionCollector("s1", "/project");
    expect(session.endTurn()).toBeNull();
  });

  it("returns current turn via getCurrentTurn", () => {
    const session = new SessionCollector("s1", "/project");
    expect(session.getCurrentTurn()).toBeNull();

    session.startTurn("active");
    const current = session.getCurrentTurn();
    expect(current).not.toBeNull();
    expect(current!.userPrompt).toBe("active");
  });
});
