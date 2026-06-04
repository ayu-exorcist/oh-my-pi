import { describe, expect, it } from "vitest";

import type { GateBypass, GateDescriptor } from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import { describeExternalDirectoryGate } from "#src/handlers/gates/external-directory";
import type { ToolCallContext } from "#src/handlers/gates/types";

// ── helpers ───────────────────────────��────────────────────────────��───────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: "/outside/project/file.ts" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

// ── tests ────────────────────��────────────────────────────────────��────────

describe("describeExternalDirectoryGate", () => {
  it("returns null when no CWD", () => {
    const result = describeExternalDirectoryGate(makeTcc({ cwd: undefined }), ["/test/agent"]);
    expect(result).toBeNull();
  });

  it("returns null when tool is not path-bearing", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ toolName: "bash", input: { command: "ls" } }),
      ["/test/agent"],
    );
    expect(result).toBeNull();
  });

  it("returns null when path is inside CWD", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ input: { path: "/test/project/src/index.ts" } }),
      ["/test/agent"],
    );
    expect(result).toBeNull();
  });

  // ── Pi infrastructure read bypass ─────────────────���────────────────────

  it("returns GateBypass for read targeting an infra dir", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({
        toolName: "read",
        input: { path: "/test/agent/git/some-package/SKILL.md" },
      }),
      ["/test/agent", "/test/agent/git"],
    );
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
    const bypass = result as GateBypass;
    expect(bypass.action).toBe("allow");
    expect(bypass.decision).toMatchObject({
      resolution: "infrastructure_auto_allowed",
      result: "allow",
    });
    expect(bypass.log).toMatchObject({
      event: "permission_request.infrastructure_auto_allowed",
    });
  });

  it("returns GateBypass respecting custom infraDirs", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({
        toolName: "read",
        input: { path: "/custom/infra/SKILL.md" },
      }),
      ["/custom/infra"],
    );
    expect(isGateBypass(result)).toBe(true);
  });

  it("does NOT bypass for write tools targeting infra dirs", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({
        toolName: "write",
        input: { path: "/test/agent/git/some-file.ts", content: "x" },
      }),
      ["/test/agent", "/test/agent/git"],
    );
    // Should be a GateDescriptor (needs permission check), not a bypass
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
  });

  // ── GateDescriptor for external paths ─────────────────────────────────��

  it("returns GateDescriptor with surface 'external_directory'", () => {
    const result = describeExternalDirectoryGate(makeTcc(), ["/test/agent"]);
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("external_directory");
  });

  it("decision value is the external path", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.decision.value).toBe("/outside/project/file.ts");
    expect(result.decision.surface).toBe("external_directory");
  });

  it("input contains normalized path for checkPermission", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.input).toHaveProperty("path");
  });

  it("sessionApproval uses deriveApprovalPattern", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.sessionApproval).toBeDefined();
    expect(result.sessionApproval).toHaveProperty("surface", "external_directory");
    expect(result.sessionApproval).toHaveProperty("pattern");
  });

  it("denialContext contains the external path and cwd", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ input: { path: "/outside/project/file.ts" } }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.denialContext).toMatchObject({
      kind: "external_directory",
      toolName: "read",
      pathValue: "/outside/project/file.ts",
      cwd: "/test/project",
    });
  });

  it("promptDetails includes path and tool_call source", () => {
    const result = describeExternalDirectoryGate(
      makeTcc({ toolName: "read", agentName: "agent-1", toolCallId: "tc-5" }),
      ["/test/agent"],
    ) as GateDescriptor;
    expect(result.promptDetails).toMatchObject({
      source: "tool_call",
      agentName: "agent-1",
      toolCallId: "tc-5",
      toolName: "read",
      path: "/outside/project/file.ts",
    });
  });

  it("logContext includes path and message", () => {
    const result = describeExternalDirectoryGate(makeTcc(), ["/test/agent"]) as GateDescriptor;
    expect(result.logContext).toMatchObject({
      source: "tool_call",
      path: "/outside/project/file.ts",
    });
    expect(result.logContext.message).toBeDefined();
  });
});
