import { describe, expect, it, vi } from "vitest";

import type { GateDescriptor } from "#src/handlers/gates/descriptor";
import { isGateDescriptor } from "#src/handlers/gates/descriptor";
import { describePathGate } from "#src/handlers/gates/path";
import type { ToolCallContext } from "#src/handlers/gates/types";
import type { Rule } from "#src/rule";
import type { PermissionCheckResult } from "#src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: ".env" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeCheckResult(overrides: Partial<PermissionCheckResult> = {}): PermissionCheckResult {
  return {
    toolName: "path",
    state: "allow",
    source: "special",
    origin: "global",
    ...overrides,
  };
}

type CheckPermissionFn = (
  surface: string,
  input: unknown,
  agentName?: string,
  sessionRules?: Rule[],
) => PermissionCheckResult;

// ── tests ──────────────────────────────────────────────────────────────────

describe("describePathGate", () => {
  const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);

  it("returns null for non-path-bearing tools", () => {
    const checkPermission = vi.fn<CheckPermissionFn>();
    const result = describePathGate(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
    expect(checkPermission).not.toHaveBeenCalled();
  });

  it("returns null when tool has no extractable path", () => {
    const checkPermission = vi.fn<CheckPermissionFn>();
    const result = describePathGate(
      makeTcc({ toolName: "read", input: {} }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
  });

  it("returns null when path check result is allow", () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "allow" }));
    const result = describePathGate(makeTcc(), checkPermission, getSessionRuleset);
    expect(result).toBeNull();
  });

  it("returns null when matchedPattern is undefined (universal default)", () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockReturnValue(
      makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
    );
    const result = describePathGate(makeTcc(), checkPermission, getSessionRuleset);
    expect(result).toBeNull();
  });

  it("returns GateDescriptor when matchedPattern is defined (explicit path rule)", () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockReturnValue(
      makeCheckResult({
        state: "ask",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
    );
    const result = describePathGate(makeTcc(), checkPermission, getSessionRuleset);
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
  });

  it("returns GateDescriptor when path check result is deny", () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockReturnValue(
      makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
      }),
    );
    const result = describePathGate(makeTcc(), checkPermission, getSessionRuleset);
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("path");
    expect(desc.preCheck?.state).toBe("deny");
  });

  it("returns GateDescriptor when path check result is ask", () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockReturnValue(
      makeCheckResult({
        state: "ask",
        matchedPattern: "*.env",
      }),
    );
    const result = describePathGate(makeTcc(), checkPermission, getSessionRuleset);
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("path");
    expect(desc.preCheck?.state).toBe("ask");
  });

  it("descriptor has correct session approval surface and pattern", () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "ask", matchedPattern: "*" }));
    const result = describePathGate(
      makeTcc({ input: { path: "/test/project/src/.env" } }),
      checkPermission,
      getSessionRuleset,
    ) as GateDescriptor;
    expect(result.sessionApproval).toBeDefined();
    expect(result.sessionApproval).toHaveProperty("surface", "path");
    expect(result.sessionApproval).toHaveProperty("pattern");
  });

  it("descriptor denialContext references the file path and tool name", () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "deny", matchedPattern: "*.env" }));
    const result = describePathGate(
      makeTcc(),
      checkPermission,
      getSessionRuleset,
    ) as GateDescriptor;
    expect(result.denialContext).toEqual({
      kind: "path",
      toolName: "read",
      pathValue: ".env",
      agentName: undefined,
    });
  });

  it("descriptor decision uses surface 'path' and the file path as value", () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "deny", matchedPattern: "*.env" }));
    const result = describePathGate(
      makeTcc(),
      checkPermission,
      getSessionRuleset,
    ) as GateDescriptor;
    expect(result.decision.surface).toBe("path");
    expect(result.decision.value).toBe(".env");
  });

  it("passes agentName and session rules to checkPermission", () => {
    const sessionRules: Rule[] = [
      {
        surface: "path",
        pattern: "/project/*",
        action: "allow",
        origin: "session",
      },
    ];
    const getSession = vi.fn<() => Rule[]>().mockReturnValue(sessionRules);
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "allow" }));
    describePathGate(makeTcc({ agentName: "my-agent" }), checkPermission, getSession);
    expect(checkPermission).toHaveBeenCalledWith(
      "path",
      { path: ".env" },
      "my-agent",
      sessionRules,
    );
  });
});
