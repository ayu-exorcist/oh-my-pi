import { afterEach, describe, expect, it, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import { describeBashPathGate } from "#src/handlers/gates/bash-path";
import type { GateBypass, GateDescriptor } from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import type { ToolCallContext } from "#src/handlers/gates/types";
import type { Rule } from "#src/rule";
import type { PermissionCheckResult } from "#src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command: "cat .env" },
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

describe("describeBashPathGate", () => {
  it("returns null for non-bash tools", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>();
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ toolName: "read", input: { path: ".env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
  });

  it("returns null when no tokens are extracted", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>();
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "echo hello" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
  });

  it("returns null when all tokens evaluate to allow", async () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "allow" }));
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
  });

  it("returns GateDescriptor when a token evaluates to deny", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockReturnValue(
      makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
      }),
    );
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("path");
    expect(desc.preCheck?.state).toBe("deny");
  });

  it("returns GateDescriptor when a token evaluates to ask", async () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "ask", matchedPattern: "*" }));
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("ask");
  });

  it("descriptor includes triggering token in prompt message", async () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "deny", matchedPattern: "*.env" }));
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = (await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    )) as GateDescriptor;
    expect(result.denialContext).toMatchObject({
      kind: "bash_path",
      command: "cat .env",
      pathValue: ".env",
    });
    expect(result.promptDetails.message).toContain(".env");
  });

  it("descriptor decision uses surface 'path'", async () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "deny", matchedPattern: "*.env" }));
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = (await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    )) as GateDescriptor;
    expect(result.decision.surface).toBe("path");
  });

  it("returns GateBypass when session rule covers the path", async () => {
    const checkPermission = vi
      .fn<CheckPermissionFn>()
      .mockReturnValue(makeCheckResult({ state: "allow", source: "session" }));
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([
      {
        surface: "path",
        pattern: "*",
        action: "allow",
        layer: "session",
        origin: "session",
      },
    ]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
    expect((result as GateBypass).action).toBe("allow");
  });

  it("returns null when command is missing", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>();
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: {} }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
  });

  it("evaluates most restrictive across multiple tokens", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockImplementation((_surface, input) => {
      const record = input as Record<string, unknown>;
      if (record.path === "src/foo.ts") {
        return makeCheckResult({ state: "allow" });
      }
      return makeCheckResult({ state: "deny", matchedPattern: "*.env" });
    });
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat src/foo.ts .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preCheck?.state).toBe("deny");
  });

  it("deny wins in multi-token: cp .env README.md", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockImplementation((_surface, input) => {
      const record = input as Record<string, unknown>;
      if (record.path === ".env") {
        return makeCheckResult({ state: "deny", matchedPattern: "*.env" });
      }
      return makeCheckResult({ state: "allow" });
    });
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cp .env README.md" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
    expect(desc.decision.value).toBe(".env");
  });

  it("extracts redirect target: echo test > .env triggers deny", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockImplementation((_surface, input) => {
      const record = input as Record<string, unknown>;
      if (record.path === ".env") {
        return makeCheckResult({ state: "deny", matchedPattern: "*.env" });
      }
      return makeCheckResult({ state: "allow" });
    });
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "echo test > .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preCheck?.state).toBe("deny");
  });

  it("returns null when all tokens match only the universal default", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockReturnValue(
      makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
    );
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).toBeNull();
  });

  it("ignores tokens matching universal default but fires for explicit rule matches", async () => {
    const checkPermission = vi.fn<CheckPermissionFn>().mockImplementation((_surface, input) => {
      const record = input as Record<string, unknown>;
      if (record.path === ".env") {
        return makeCheckResult({
          state: "deny",
          matchedPattern: "*.env",
        });
      }
      // Other tokens match only the universal default
      return makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      });
    });
    const getSessionRuleset = vi.fn<() => Rule[]>().mockReturnValue([]);
    const result = await describeBashPathGate(
      makeTcc({ input: { command: "cat src/foo.ts .env" } }),
      checkPermission,
      getSessionRuleset,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
    expect(desc.decision.value).toBe(".env");
  });
});
