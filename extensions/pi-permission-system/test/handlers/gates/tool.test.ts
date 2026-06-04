import { describe, expect, it } from "vitest";

import { describeToolGate } from "#src/handlers/gates/tool";
import type { ToolCallContext } from "#src/handlers/gates/types";
import type { PermissionCheckResult } from "#src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: {},
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "read",
    source: "tool",
    origin: "builtin",
    matchedPattern: "*",
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("describeToolGate", () => {
  it("returns descriptor with tool name as surface for standard tools", () => {
    const desc = describeToolGate(makeTcc({ toolName: "read" }), makeCheckResult("ask"));
    expect(desc.surface).toBe("read");
    expect(desc.decision.surface).toBe("read");
  });

  it("returns descriptor with tool name as decision value for standard tools", () => {
    const desc = describeToolGate(makeTcc({ toolName: "write" }), makeCheckResult("ask"));
    expect(desc.decision.value).toBe("write");
  });

  it("returns bash surface with command in decision.value for bash tools", () => {
    const check = makeCheckResult("ask", {
      toolName: "bash",
      command: "git status",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "git status" } }),
      check,
    );
    expect(desc.surface).toBe("bash");
    expect(desc.decision.surface).toBe("bash");
    expect(desc.decision.value).toBe("git status");
  });

  it("returns mcp surface with target in decision.value for MCP tools", () => {
    const check = makeCheckResult("ask", {
      toolName: "mcp",
      target: "server:tool",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "mcp", input: { tool: "server:tool" } }),
      check,
    );
    expect(desc.surface).toBe("mcp");
    expect(desc.decision.surface).toBe("mcp");
    expect(desc.decision.value).toBe("server:tool");
  });

  it("populates denialContext with kind 'tool' and check result", () => {
    const check = makeCheckResult("deny", { toolName: "read" });
    const desc = describeToolGate(makeTcc(), check);
    expect(desc.denialContext).toEqual({
      kind: "tool",
      check,
      agentName: undefined,
      input: {},
    });
  });

  it("populates denialContext with agent name when provided", () => {
    const check = makeCheckResult("ask", { toolName: "read" });
    const desc = describeToolGate(makeTcc({ agentName: "my-agent" }), check);
    expect(desc.denialContext.agentName).toBe("my-agent");
  });

  it("populates denialContext with input for tool context", () => {
    const check = makeCheckResult("ask", { toolName: "bash", command: "ls" });
    const desc = describeToolGate(makeTcc({ toolName: "bash", input: { command: "ls" } }), check);
    expect(desc.denialContext).toMatchObject({
      kind: "tool",
      input: { command: "ls" },
    });
  });

  it("populates sessionApproval via suggestSessionPattern", () => {
    const check = makeCheckResult("ask", {
      toolName: "bash",
      command: "git status",
    });
    const desc = describeToolGate(
      makeTcc({ toolName: "bash", input: { command: "git status" } }),
      check,
    );
    expect(desc.sessionApproval).toBeDefined();
    expect(desc.sessionApproval!).toHaveProperty("surface", "bash");
    expect(desc.sessionApproval!).toHaveProperty("pattern");
  });

  it("populates promptDetails with correct fields", () => {
    const check = makeCheckResult("ask");
    const desc = describeToolGate(
      makeTcc({ toolName: "read", agentName: "my-agent", toolCallId: "tc-42" }),
      check,
    );
    expect(desc.promptDetails).toMatchObject({
      source: "tool_call",
      agentName: "my-agent",
      toolCallId: "tc-42",
      toolName: "read",
    });
    expect(desc.promptDetails.message).toBeDefined();
    expect(desc.promptDetails.sessionLabel).toBeDefined();
  });

  it("populates logContext with tool input preview fields", () => {
    const check = makeCheckResult("ask", { toolName: "bash", command: "ls" });
    const desc = describeToolGate(makeTcc({ toolName: "bash", input: { command: "ls" } }), check);
    expect(desc.logContext).toMatchObject({
      source: "tool_call",
      toolName: "bash",
    });
    expect(desc.logContext.command).toBe("ls");
  });

  it("uses toolName as input for checkPermission surface", () => {
    const desc = describeToolGate(
      makeTcc({ toolName: "edit", input: { path: "/a.ts" } }),
      makeCheckResult("ask", { toolName: "edit" }),
    );
    expect(desc.surface).toBe("edit");
    expect(desc.input).toEqual({ path: "/a.ts" });
  });
});
