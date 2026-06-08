import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gateMocks = vi.hoisted(() => ({
  skillDescriptor: null as unknown,
  pathDescriptor: null as unknown,
  externalDirectoryDescriptor: null as unknown,
  bashExternalDirectoryDescriptor: null as unknown,
  bashPathDescriptor: null as unknown,
  runnerResults: [] as Array<{ action: "allow" } | { action: "block"; reason: string }>,
  describeSkillReadGate: vi.fn(),
  describePathGate: vi.fn(),
  describeExternalDirectoryGate: vi.fn(),
  describeBashExternalDirectoryGate: vi.fn(),
  describeBashPathGate: vi.fn(),
  runGateCheck: vi.fn(),
}));

vi.mock("../../src/handlers/gates/skill-read", () => ({
  describeSkillReadGate: gateMocks.describeSkillReadGate,
}));

vi.mock("../../src/handlers/gates/path", () => ({
  describePathGate: gateMocks.describePathGate,
}));

vi.mock("../../src/handlers/gates/external-directory", () => ({
  describeExternalDirectoryGate: gateMocks.describeExternalDirectoryGate,
}));

vi.mock("../../src/handlers/gates/bash-external-directory", () => ({
  describeBashExternalDirectoryGate: gateMocks.describeBashExternalDirectoryGate,
}));

vi.mock("../../src/handlers/gates/bash-path", () => ({
  describeBashPathGate: gateMocks.describeBashPathGate,
}));

vi.mock("../../src/handlers/gates/runner", () => ({
  runGateCheck: gateMocks.runGateCheck,
}));

import { PermissionGateHandler } from "#src/handlers/permission-gate-handler";
import type { PermissionSession } from "#src/permission-session";
import type { ToolRegistry } from "#src/tool-registry";
import type { PermissionCheckResult } from "#src/types";

function makeCtx(): ExtensionContext {
  return {
    cwd: "/workspace",
    hasUI: true,
    ui: { notify: vi.fn(), setStatus: vi.fn(), select: vi.fn(), input: vi.fn() },
    sessionManager: { getEntries: vi.fn(), getSessionDir: vi.fn(), addEntry: vi.fn() },
  } as unknown as ExtensionContext;
}

function allowResult(): PermissionCheckResult {
  return { state: "allow", toolName: "read", source: "tool", origin: "builtin" };
}

function makeSession(): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue("coder"),
    checkPermission: vi.fn().mockReturnValue(allowResult()),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    getActiveSkillEntries: vi.fn().mockReturnValue([]),
    getInfrastructureDirs: vi.fn().mockReturnValue([]),
    getInfrastructureReadPaths: vi.fn().mockReturnValue([]),
    canPrompt: vi.fn().mockReturnValue(true),
    prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
  } as unknown as PermissionSession;
}

function makeHandler(): { handler: PermissionGateHandler; session: PermissionSession } {
  const session = makeSession();
  const events = { emit: vi.fn(), on: vi.fn() };
  const registry: ToolRegistry = {
    getAll: vi.fn().mockReturnValue([{ name: "read" }, { name: "bash" }]),
    setActive: vi.fn(),
  };
  return { handler: new PermissionGateHandler(session, events, registry), session };
}

function makeDescriptor(surface = "path") {
  return {
    kind: "gate" as const,
    surface,
    input: { path: "/outside" },
    message: "check path",
    preCheck: allowResult(),
  };
}

function makeBypass(overrides: Record<string, unknown> = {}) {
  return {
    action: "allow" as const,
    ...overrides,
  };
}

beforeEach(() => {
  gateMocks.skillDescriptor = null;
  gateMocks.pathDescriptor = null;
  gateMocks.externalDirectoryDescriptor = null;
  gateMocks.bashExternalDirectoryDescriptor = null;
  gateMocks.bashPathDescriptor = null;
  gateMocks.runnerResults = [];
  gateMocks.describeSkillReadGate.mockReset().mockImplementation(() => gateMocks.skillDescriptor);
  gateMocks.describePathGate.mockReset().mockImplementation(() => gateMocks.pathDescriptor);
  gateMocks.describeExternalDirectoryGate
    .mockReset()
    .mockImplementation(() => gateMocks.externalDirectoryDescriptor);
  gateMocks.describeBashExternalDirectoryGate
    .mockReset()
    .mockImplementation(() => Promise.resolve(gateMocks.bashExternalDirectoryDescriptor));
  gateMocks.describeBashPathGate
    .mockReset()
    .mockImplementation(() => Promise.resolve(gateMocks.bashPathDescriptor));
  gateMocks.runGateCheck
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(gateMocks.runnerResults.shift() ?? { action: "allow" }),
    );
});

describe("PermissionGateHandler branch coverage", () => {
  it("blocks when the skill-read gate runner blocks", async () => {
    gateMocks.skillDescriptor = makeDescriptor("skill");
    gateMocks.runnerResults = [{ action: "block", reason: "skill denied" }];
    const { handler } = makeHandler();

    await expect(
      handler.handleToolCall(
        { type: "tool_call", name: "read", input: { path: "/skill" } },
        makeCtx(),
      ),
    ).resolves.toEqual({ block: true, reason: "skill denied" });
  });

  it("logs path bypasses", async () => {
    gateMocks.pathDescriptor = makeBypass({
      log: { event: "path.bypass", details: { path: "/workspace/file" } },
    });
    const { handler, session } = makeHandler();

    await expect(
      handler.handleToolCall(
        { type: "tool_call", name: "read", input: { path: "file" } },
        makeCtx(),
      ),
    ).resolves.toEqual({});
    expect(session.logger.review).toHaveBeenCalledWith("path.bypass", { path: "/workspace/file" });
  });

  it("emits external-directory bypass decisions and logs when present", async () => {
    gateMocks.externalDirectoryDescriptor = makeBypass({
      log: { event: "external.bypass", details: { path: "/agent" } },
      decision: { surface: "external_directory", decision: "allow", toolCallId: "tc-1" },
    });
    const { handler, session } = makeHandler();

    await expect(
      handler.handleToolCall(
        { type: "tool_call", toolCallId: "tc-1", name: "read", input: { path: "/agent/file" } },
        makeCtx(),
      ),
    ).resolves.toEqual({});
    expect(session.logger.review).toHaveBeenCalledWith("external.bypass", { path: "/agent" });
  });

  it("logs bash external-directory bypasses", async () => {
    gateMocks.bashExternalDirectoryDescriptor = makeBypass({
      log: { event: "bash-external.bypass", details: { path: "/agent" } },
    });
    const { handler, session } = makeHandler();

    await expect(
      handler.handleToolCall(
        { type: "tool_call", name: "bash", input: { command: "cat /agent/file" } },
        makeCtx(),
      ),
    ).resolves.toEqual({});
    expect(session.logger.review).toHaveBeenCalledWith("bash-external.bypass", { path: "/agent" });
  });

  it("logs bash path bypasses", async () => {
    gateMocks.bashPathDescriptor = makeBypass({
      log: { event: "bash-path.bypass", details: { path: "/workspace/file" } },
    });
    const { handler, session } = makeHandler();

    await expect(
      handler.handleToolCall(
        { type: "tool_call", name: "bash", input: { command: "cat file" } },
        makeCtx(),
      ),
    ).resolves.toEqual({});
    expect(session.logger.review).toHaveBeenCalledWith("bash-path.bypass", {
      path: "/workspace/file",
    });
  });

  it("blocks when later gate runners block", async () => {
    gateMocks.pathDescriptor = makeDescriptor("path");
    gateMocks.externalDirectoryDescriptor = makeDescriptor("external_directory");
    gateMocks.bashExternalDirectoryDescriptor = makeDescriptor("external_directory");
    gateMocks.bashPathDescriptor = makeDescriptor("path");
    gateMocks.runnerResults = [
      { action: "allow" },
      { action: "allow" },
      { action: "allow" },
      { action: "block", reason: "bash path denied" },
    ];
    const { handler } = makeHandler();

    await expect(
      handler.handleToolCall(
        { type: "tool_call", name: "bash", input: { command: "cat file" } },
        makeCtx(),
      ),
    ).resolves.toEqual({ block: true, reason: "bash path denied" });
  });
});
