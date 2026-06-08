import { describe, it, expect } from "vitest";
import { buildSessionSummary, formatSessionStats } from "./analyzer";
import { TurnCollector } from "./collector";

describe("analyzeTurn", () => {
  it("detects error loop from repeated commands", () => {
    const turn = new TurnCollector(1, "fix bug");
    for (let i = 0; i < 3; i++) {
      turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test" } });
    }

    const trace = turn.finalize();
    const errorLoop = trace.failureSignals.find((s) => s.type === "error_loop");
    expect(errorLoop).toBeDefined();
    expect(errorLoop!.severity).toBe("warning");
    expect(errorLoop!.turnIndex).toBe(1);
  });

  it("normalizes bash commands before counting error loops", () => {
    const turn = new TurnCollector(1, "fix bug");
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test --runInBand" } });
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test --runInBand" } });

    const trace = turn.finalize();
    expect(trace.failureSignals.some((s) => s.type === "error_loop")).toBe(true);
  });

  it("escalates error loop to critical after 4 repetitions", () => {
    const turn = new TurnCollector(1, "fix bug");
    for (let i = 0; i < 5; i++) {
      turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test" } });
    }

    const trace = turn.finalize();
    const errorLoop = trace.failureSignals.find((s) => s.type === "error_loop");
    expect(errorLoop!.severity).toBe("critical");
  });

  it("detects high retry from many tool calls", () => {
    const turn = new TurnCollector(1, "explore");
    for (let i = 0; i < 35; i++) {
      turn.recordToolCall({ toolName: "read", input: { path: `file${i}.ts` } });
    }

    const trace = turn.finalize();
    const highRetry = trace.failureSignals.find((s) => s.type === "high_retry");
    expect(highRetry).toBeDefined();
    expect(highRetry!.severity).toBe("warning");
  });

  it("escalates high retry to critical above 50", () => {
    const turn = new TurnCollector(1, "explore");
    for (let i = 0; i < 55; i++) {
      turn.recordToolCall({ toolName: "read", input: { path: `file${i}.ts` } });
    }

    const trace = turn.finalize();
    const highRetry = trace.failureSignals.find((s) => s.type === "high_retry");
    expect(highRetry!.severity).toBe("critical");
  });

  it("detects scope creep from many modified files", () => {
    const turn = new TurnCollector(1, "refactor");
    for (let i = 0; i < 6; i++) {
      turn.recordToolCall({ toolName: "write", input: { path: `src/${i}.ts` } });
    }

    const trace = turn.finalize();
    const scopeCreep = trace.failureSignals.find((s) => s.type === "scope_creep");
    expect(scopeCreep).toBeDefined();
    expect(scopeCreep!.severity).toBe("warning");
  });

  it("escalates scope creep to critical above 10 files", () => {
    const turn = new TurnCollector(1, "big refactor");
    for (let i = 0; i < 12; i++) {
      turn.recordToolCall({ toolName: "edit", input: { path: `src/${i}.ts` } });
    }

    const trace = turn.finalize();
    const scopeCreep = trace.failureSignals.find((s) => s.type === "scope_creep");
    expect(scopeCreep!.severity).toBe("critical");
  });

  it("detects repeated reads of the same file", () => {
    const turn = new TurnCollector(1, "confused");
    for (let i = 0; i < 4; i++) {
      turn.recordToolCall({ toolName: "read", input: { path: "src/index.ts" } });
    }

    const trace = turn.finalize();
    const repeatedRead = trace.failureSignals.find((s) => s.type === "repeated_read");
    expect(repeatedRead).toBeDefined();
    expect(repeatedRead!.severity).toBe("info");
  });

  it("detects verification heuristic when check runs early", () => {
    const turn = new TurnCollector(1, "implement");
    // Run verification early
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test" } });
    // Then many more bash commands without re-verification
    for (let i = 0; i < 6; i++) {
      turn.recordToolCall({ toolName: "bash", input: { command: `echo ${i}` } });
    }

    const trace = turn.finalize();
    const heuristic = trace.failureSignals.find((s) => s.type === "verification_heuristic");
    expect(heuristic).toBeDefined();
    expect(heuristic!.severity).toBe("info");
  });

  it("does not detect verification heuristic when verification is near the end", () => {
    const turn = new TurnCollector(1, "implement");
    for (let i = 0; i < 5; i++) {
      turn.recordToolCall({ toolName: "bash", input: { command: `echo ${i}` } });
    }
    turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test" } });

    const trace = turn.finalize();
    expect(trace.failureSignals.some((s) => s.type === "verification_heuristic")).toBe(false);
  });

  it("returns empty signals for clean turn", () => {
    const turn = new TurnCollector(1, "simple task");
    turn.recordToolCall({ toolName: "read", input: { path: "a.ts" } });
    turn.recordToolCall({ toolName: "write", input: { path: "b.ts" } });

    const trace = turn.finalize();
    expect(trace.failureSignals).toHaveLength(0);
  });
});

describe("buildSessionSummary", () => {
  it("aggregates totals across turns", () => {
    const t1 = new TurnCollector(1, "t1");
    t1.recordToolCall({ toolName: "read", input: { path: "a.ts" } });
    t1.recordToolCall({ toolName: "write", input: { path: "b.ts" } });

    const t2 = new TurnCollector(2, "t2");
    t2.recordToolCall({ toolName: "read", input: { path: "c.ts" } });

    const summary = buildSessionSummary([t1.finalize(), t2.finalize()]);
    expect(summary.totalToolCalls).toBe(3);
    expect(summary.totalFilesRead).toBe(2);
    expect(summary.totalFilesWritten).toBe(1);
  });

  it("flags error loop detection", () => {
    const turn = new TurnCollector(1, "loop");
    for (let i = 0; i < 3; i++) {
      turn.recordToolCall({ toolName: "bash", input: { command: "pnpm test" } });
    }

    const summary = buildSessionSummary([turn.finalize()]);
    expect(summary.errorLoopDetected).toBe(true);
    expect(summary.failureCount).toBeGreaterThan(0);
  });
});

describe("formatSessionStats", () => {
  it("formats basic stats", () => {
    const turn = new TurnCollector(1, "task");
    turn.recordToolCall({ toolName: "read", input: { path: "a.ts" } });

    const trace = {
      turns: [turn.finalize()],
      summary: buildSessionSummary([turn.finalize()]),
    };

    const text = formatSessionStats(trace);
    expect(text).toContain("Turns: 1");
    expect(text).toContain("Tool calls: 1");
    expect(text).toContain("Files read: 1");
  });

  it("includes warning and critical signal icons in output", () => {
    const warningTurn = new TurnCollector(1, "buggy");
    for (let i = 0; i < 35; i++) {
      warningTurn.recordToolCall({ toolName: "read", input: { path: `f${i}.ts` } });
    }

    const criticalTurn = new TurnCollector(2, "very buggy");
    for (let i = 0; i < 55; i++) {
      criticalTurn.recordToolCall({ toolName: "read", input: { path: `f${i}.ts` } });
    }

    const infoTurn = new TurnCollector(3, "confused");
    for (let i = 0; i < 4; i++) {
      infoTurn.recordToolCall({ toolName: "read", input: { path: "same.ts" } });
    }

    const finalized = [warningTurn.finalize(), criticalTurn.finalize(), infoTurn.finalize()];
    const trace = {
      turns: finalized,
      summary: buildSessionSummary(finalized),
    };

    const text = formatSessionStats(trace);
    expect(text).toContain("Signals:");
    expect(text).toContain("🟡 [T1] high_retry");
    expect(text).toContain("🔴 [T2] high_retry");
    expect(text).toContain("🔵 [T3] repeated_read");
  });
});
