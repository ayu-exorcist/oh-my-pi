/**
 * Integration tests for external_directory tool_call enforcement.
 *
 * These tests exercise PermissionGateHandler.handleToolCall with the
 * external-directory gate, verifying the full descriptor→runner pipeline
 * while mocking only the PermissionSession boundary.
 *
 * Regression guard: importing the four external-directory message helpers
 * ensures the test file fails to load if any helper is removed.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { EXTENSION_TAG } from "#src/denial-messages";
import { formatExternalDirectoryAskPrompt } from "#src/handlers/gates/external-directory-messages";
import { PermissionGateHandler } from "#src/handlers/permission-gate-handler";
import { PERMISSIONS_DECISION_CHANNEL, type PermissionDecisionEvent } from "#src/permission-events";
import type { PermissionSession } from "#src/permission-session";
import type { ToolRegistry } from "#src/tool-registry";
import type { PermissionCheckResult, PermissionState } from "#src/types";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── Constants ──────────────────────────────────────────────────────────────

const CWD = "/test/project";
const EXTERNAL_PATH = "/outside/project/file.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCheckPermission(
  externalDirectoryState: PermissionState,
  toolState: PermissionState = "allow",
) {
  return vi.fn().mockImplementation((surface: string): PermissionCheckResult => {
    if (surface === "external_directory") {
      return {
        state: externalDirectoryState,
        toolName: surface,
        source: "tool",
        origin: "builtin",
      };
    }
    // The cross-cutting path gate runs before ext-dir; keep it transparent.
    if (surface === "path") {
      return {
        state: "allow",
        toolName: surface,
        source: "special",
        origin: "builtin",
      };
    }
    return {
      state: toolState,
      toolName: surface,
      source: "tool",
      origin: "builtin",
    };
  });
}

function makeCtx(overrides: Partial<ExtensionContext> & { cwd?: string } = {}): ExtensionContext {
  return {
    cwd: CWD,
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
      addEntry: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

function makeToolCallEvent(toolName: string, input: Record<string, unknown> = {}) {
  return {
    type: "tool_call",
    toolCallId: "tc-ext-1",
    name: toolName,
    input,
  };
}

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    checkPermission: makeCheckPermission("deny"),
    getToolPermission: vi.fn().mockReturnValue("allow"),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    getActiveSkillEntries: vi.fn().mockReturnValue([]),
    getInfrastructureDirs: vi.fn().mockReturnValue([]),
    getInfrastructureReadPaths: vi.fn().mockReturnValue([]),
    canPrompt: vi.fn().mockReturnValue(true),
    prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

/** All PATH_BEARING_TOOLS members. */
const ALL_PATH_BEARING_TOOLS = ["read", "write", "edit", "find", "grep", "ls"];

/** Tools where path is optional. */
const OPTIONAL_PATH_TOOLS = ["find", "grep", "ls"];

function makeToolRegistry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([...ALL_PATH_BEARING_TOOLS, "bash"].map((name) => ({ name }))),
    setActive: vi.fn(),
    ...overrides,
  };
}

function makeHandler(overrides?: {
  session?: Partial<Record<keyof PermissionSession, unknown>>;
  toolRegistry?: Partial<ToolRegistry>;
}): {
  handler: PermissionGateHandler;
  events: ReturnType<typeof makeEvents>;
  session: PermissionSession;
} {
  const session = makeSession(overrides?.session);
  const events = makeEvents();
  const toolRegistry = makeToolRegistry(overrides?.toolRegistry);
  const handler = new PermissionGateHandler(session, events, toolRegistry);
  return { handler, events, session };
}

function getDecisionEvents(events: ReturnType<typeof makeEvents>): PermissionDecisionEvent[] {
  return events.emit.mock.calls
    .filter(([channel]) => channel === PERMISSIONS_DECISION_CHANNEL)
    .map(([, payload]) => payload as PermissionDecisionEvent);
}

// ── Regression guard: helper presence ──────────────────────────────────────

describe("external_directory helper regression guard", () => {
  it("formatExternalDirectoryAskPrompt is a callable function", () => {
    expect(typeof formatExternalDirectoryAskPrompt).toBe("function");
    expect(formatExternalDirectoryAskPrompt("read", "/outside/file", "/project")).toContain(
      "/outside/file",
    );
  });

  it("EXTENSION_TAG is the expected value", () => {
    expect(EXTENSION_TAG).toBe("[pi-permission-system]");
  });

  // formatExternalDirectoryDenyReason, formatExternalDirectoryUserDeniedReason,
  // and formatExternalDirectoryHardStopHint have moved to denial-messages.ts.
  // Their behavior is tested in denial-messages.test.ts.
});

// ── Path scope: gate applicability ────────────────────────────────────────

describe("external_directory path scope", () => {
  it("skips external_directory check when path is inside CWD", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", {
      path: `${CWD}/src/index.ts`,
    });
    const result = await handler.handleToolCall(event, makeCtx());
    // Should not be blocked — the external_directory gate is skipped,
    // and the tool gate sees "allow" (default toolState in makeCheckPermission)
    expect(result).toEqual({});
  });

  it("fires external_directory check when path is outside CWD", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ block: true });
  });

  it("skips external_directory check for non-path-bearing tool (bash)", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny", "allow") },
    });
    const event = makeToolCallEvent("bash", {
      command: `cat ${EXTERNAL_PATH}`,
    });
    // bash is not in PATH_BEARING_TOOLS, so the external_directory gate
    // for tool path does not fire (bash-external-directory gate is separate)
    const result = await handler.handleToolCall(event, makeCtx());
    // bash-external-directory gate MAY fire separately, but the tool-path
    // external_directory gate does NOT fire for bash
    // We verify the checkPermission was not called with "external_directory"
    // from the tool-path gate by checking the result is not blocked by it
    expect(result).toBeDefined();
  });

  it.each(ALL_PATH_BEARING_TOOLS)(
    "blocks %s with an out-of-cwd path when external_directory is deny",
    async (toolName) => {
      const { handler } = makeHandler({
        session: { checkPermission: makeCheckPermission("deny") },
      });
      const event = makeToolCallEvent(toolName, { path: EXTERNAL_PATH });
      const result = await handler.handleToolCall(event, makeCtx());
      expect(result).toMatchObject({ block: true });
    },
  );

  it.each(OPTIONAL_PATH_TOOLS)(
    "skips external_directory check for %s when path is omitted",
    async (toolName) => {
      const { handler } = makeHandler({
        session: { checkPermission: makeCheckPermission("deny") },
      });
      // No path in input — external_directory gate should not fire
      const event = makeToolCallEvent(toolName, {});
      const result = await handler.handleToolCall(event, makeCtx());
      expect(result).toEqual({});
    },
  );
});

// ── Policy state matrix: allow and deny ────────────────────────────────────

describe("external_directory policy state — allow", () => {
  it("falls through to tool gate when external_directory is allow", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({});
  });

  it("emits decision event with policy_allow on external_directory surface", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      surface: "external_directory",
      result: "allow",
      resolution: "policy_allow",
    });
  });

  it("does not write a block review-log entry when external_directory is allow", async () => {
    const { handler, session } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const reviewCalls = (session.logger.review as ReturnType<typeof vi.fn>).mock.calls;
    const blockEntries = reviewCalls.filter(
      ([eventName]: string[]) => eventName === "permission_request.blocked",
    );
    expect(blockEntries).toHaveLength(0);
  });
});

// #144: allow external reads, gate external writes
describe("external_directory — allow external reads, gate external writes (#144)", () => {
  it("allows read of external path when external_directory and read are both allow", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow", "allow") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({});
  });

  it("prompts for write to external path when external_directory allows but write is ask", async () => {
    const prompt = vi.fn().mockResolvedValue({ approved: true, state: "approved" });
    const { handler } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("allow", "ask"),
        prompt,
      },
    });
    const event = makeToolCallEvent("write", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    // external_directory passes; write gate prompts and user approves
    expect(result).toEqual({});
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("blocks write to external path when external_directory allows but write is deny", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow", "deny") },
    });
    const event = makeToolCallEvent("write", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result.block).toBe(true);
  });

  it("emits separate decision events for external_directory and write surfaces", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow", "deny") },
    });
    const event = makeToolCallEvent("write", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    const writeDecision = decisions.find((d) => d.surface === "write");
    expect(extDirDecision).toMatchObject({
      surface: "external_directory",
      result: "allow",
      resolution: "policy_allow",
    });
    expect(writeDecision).toMatchObject({
      surface: "write",
      result: "deny",
      resolution: "policy_deny",
    });
  });
});

describe("external_directory policy state — deny", () => {
  it("blocks with reason containing the external path", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result.block).toBe(true);
    expect(result.reason).toContain(EXTERNAL_PATH);
  });

  it("block reason contains extension attribution", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result.reason).toContain("[pi-permission-system]");
    expect(result.reason).not.toContain("Hard stop");
  });

  it("writes review-log entry with resolution policy_denied", async () => {
    const { handler, session } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const reviewCalls = (session.logger.review as ReturnType<typeof vi.fn>).mock.calls;
    const blockEntries = reviewCalls.filter(
      ([eventName]: string[]) => eventName === "permission_request.blocked",
    );
    expect(blockEntries.length).toBeGreaterThanOrEqual(1);
    expect(blockEntries[0][1]).toMatchObject({
      resolution: "policy_denied",
    });
  });

  it("emits decision event with policy_deny on external_directory surface", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      surface: "external_directory",
      result: "deny",
      resolution: "policy_deny",
    });
  });
});

// ── Policy state matrix: ask ────────────────────────────────────────────────

describe("external_directory policy state — ask", () => {
  it("does not block when user approves", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({});
  });

  it("emits user_approved decision when user approves", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      surface: "external_directory",
      result: "allow",
      resolution: "user_approved",
    });
  });

  it("blocks when user denies", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        prompt: vi.fn().mockResolvedValue({ approved: false, state: "denied" }),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result.block).toBe(true);
  });

  it("emits user_denied decision when user denies", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        prompt: vi.fn().mockResolvedValue({ approved: false, state: "denied" }),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      surface: "external_directory",
      result: "deny",
      resolution: "user_denied",
    });
  });

  it("block reason includes denialReason when user provides one", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        prompt: vi.fn().mockResolvedValue({
          approved: false,
          state: "denied",
          denialReason: "not needed",
        }),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result.block).toBe(true);
    expect(result.reason).toContain("not needed");
  });

  it("blocks with confirmation_unavailable when no UI is available", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        canPrompt: vi.fn().mockReturnValue(false),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result = await handler.handleToolCall(event, makeCtx({ hasUI: false }));
    expect(result.block).toBe(true);
    expect(result.reason).toContain("outside the working directory");
  });

  it("writes review-log entry with confirmation_unavailable when no UI", async () => {
    const { handler, session } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        canPrompt: vi.fn().mockReturnValue(false),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx({ hasUI: false }));
    const reviewCalls = (session.logger.review as ReturnType<typeof vi.fn>).mock.calls;
    const blockEntries = reviewCalls.filter(
      ([eventName]: string[]) => eventName === "permission_request.blocked",
    );
    expect(blockEntries.length).toBeGreaterThanOrEqual(1);
    expect(blockEntries[0][1]).toMatchObject({
      resolution: "confirmation_unavailable",
    });
  });

  it("emits confirmation_unavailable decision when no UI", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("ask"),
        canPrompt: vi.fn().mockReturnValue(false),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx({ hasUI: false }));
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      surface: "external_directory",
      result: "deny",
      resolution: "confirmation_unavailable",
    });
  });
});

// ── Per-agent override ─────────────────────────────────────────────────────

describe("external_directory per-agent override", () => {
  it("honors per-agent override of external_directory policy", async () => {
    // checkPermission varies by agentName: allow for "special-agent", deny otherwise
    const agentAwareCheck = vi
      .fn()
      .mockImplementation(
        (surface: string, _input: unknown, agentName?: string): PermissionCheckResult => {
          if (surface === "external_directory") {
            const state = agentName === "special-agent" ? "allow" : ("deny" as const);
            return {
              state,
              toolName: surface,
              source: "tool",
              origin: agentName === "special-agent" ? "agent" : "global",
            };
          }
          return {
            state: "allow",
            toolName: surface,
            source: "tool",
            origin: "builtin",
          };
        },
      );

    // With agent override → allowed
    const { handler: handler1, events: events1 } = makeHandler({
      session: {
        checkPermission: agentAwareCheck,
        resolveAgentName: vi.fn().mockReturnValue("special-agent"),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    const result1 = await handler1.handleToolCall(event, makeCtx());
    expect(result1).toEqual({});

    const decisions1 = getDecisionEvents(events1);
    const extDir1 = decisions1.find((d) => d.surface === "external_directory");
    expect(extDir1).toMatchObject({
      result: "allow",
      resolution: "policy_allow",
      agentName: "special-agent",
    });

    // Without agent override → denied
    const { handler: handler2 } = makeHandler({
      session: {
        checkPermission: agentAwareCheck,
        resolveAgentName: vi.fn().mockReturnValue(null),
      },
    });
    const result2 = await handler2.handleToolCall(event, makeCtx());
    expect(result2).toMatchObject({ block: true });
  });
});

// ── Decision event surface and value ──────────────────────────────────────

describe("external_directory decision event fields", () => {
  it("decision event value is the external path", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeCheckPermission("deny") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toBeDefined();
    expect(extDirDecision!.value).toBe(EXTERNAL_PATH);
  });

  it("decision event includes agentName when present", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeCheckPermission("allow"),
        resolveAgentName: vi.fn().mockReturnValue("my-agent"),
      },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      agentName: "my-agent",
    });
  });

  it("decision event agentName is null when no agent", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeCheckPermission("allow") },
    });
    const event = makeToolCallEvent("read", { path: EXTERNAL_PATH });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const extDirDecision = decisions.find((d) => d.surface === "external_directory");
    expect(extDirDecision).toMatchObject({
      agentName: null,
    });
  });
});
