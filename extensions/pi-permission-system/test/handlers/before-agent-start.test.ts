import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { AgentPrepHandler, shouldExposeTool } from "#src/handlers/before-agent-start";
import type { PermissionSession } from "#src/permission-session";
import type { ToolRegistry } from "#src/tool-registry";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    isToolCallEventType: vi.fn().mockReturnValue(false),
  };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/test/project",
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

function makeEvent(systemPrompt = "You are an assistant.") {
  return { systemPrompt };
}

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    refreshConfig: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    getToolPermission: vi.fn().mockReturnValue("allow"),
    checkPermission: vi.fn().mockReturnValue({ state: "allow" }),
    shouldUpdateActiveTools: vi.fn().mockReturnValue(true),
    commitActiveToolsCacheKey: vi.fn(),
    getPolicyCacheStamp: vi.fn().mockReturnValue("stamp-1"),
    shouldUpdatePromptState: vi.fn().mockReturnValue(true),
    commitPromptStateCacheKey: vi.fn(),
    setActiveSkillEntries: vi.fn(),
    getActiveSkillEntries: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeToolRegistry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([]),
    setActive: vi.fn(),
    ...overrides,
  };
}

function makeHandler(overrides?: {
  session?: Partial<Record<keyof PermissionSession, unknown>>;
  toolRegistry?: Partial<ToolRegistry>;
}): {
  handler: AgentPrepHandler;
  session: PermissionSession;
  toolRegistry: ToolRegistry;
} {
  const session = makeSession(overrides?.session);
  const toolRegistry = makeToolRegistry(overrides?.toolRegistry);
  const handler = new AgentPrepHandler(session, toolRegistry);
  return { handler, session, toolRegistry };
}

// ── shouldExposeTool (pure helper) ─────────────────────────────────────────

describe("shouldExposeTool", () => {
  it("returns true when tool permission is allow", () => {
    const getter = vi.fn().mockReturnValue("allow");
    expect(shouldExposeTool("read", null, getter)).toBe(true);
  });

  it("returns true when tool permission is ask", () => {
    const getter = vi.fn().mockReturnValue("ask");
    expect(shouldExposeTool("bash", "agent-x", getter)).toBe(true);
  });

  it("returns false when tool permission is deny", () => {
    const getter = vi.fn().mockReturnValue("deny");
    expect(shouldExposeTool("write", null, getter)).toBe(false);
  });

  it("passes agentName through to getToolPermission", () => {
    const getter = vi.fn().mockReturnValue("allow");
    shouldExposeTool("read", "my-agent", getter);
    expect(getter).toHaveBeenCalledWith("read", "my-agent");
  });

  it("converts null agentName to undefined for getToolPermission", () => {
    const getter = vi.fn().mockReturnValue("allow");
    shouldExposeTool("read", null, getter);
    expect(getter).toHaveBeenCalledWith("read", undefined);
  });
});

// ── AgentPrepHandler.handle ────────────────────────────────────────────────

describe("AgentPrepHandler.handle", () => {
  it("activates the session with ctx", async () => {
    const ctx = makeCtx();
    const { handler, session } = makeHandler();
    await handler.handle(makeEvent(), ctx);
    expect(session.activate).toHaveBeenCalledWith(ctx);
  });

  it("refreshes config with ctx", async () => {
    const ctx = makeCtx();
    const { handler, session } = makeHandler();
    await handler.handle(makeEvent(), ctx);
    expect(session.refreshConfig).toHaveBeenCalledWith(ctx);
  });

  it("resolves agent name using systemPrompt", async () => {
    const ctx = makeCtx();
    const { handler, session } = makeHandler();
    await handler.handle(makeEvent("<active_agent name='x'>"), ctx);
    expect(session.resolveAgentName).toHaveBeenCalledWith(ctx, "<active_agent name='x'>");
  });

  it("filters out denied tools from allowed list", async () => {
    const { handler, toolRegistry } = makeHandler({
      session: { getToolPermission: vi.fn().mockReturnValue("deny") },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "write" }, { name: "read" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith([]);
  });

  it("includes allowed and ask tools in the active list", async () => {
    const { handler, toolRegistry } = makeHandler({
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }, { name: "write" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith(["read", "write"]);
  });

  it("skips unnamed tool registry entries", async () => {
    const { handler, toolRegistry } = makeHandler({
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ unrelated: "x" }, null, { name: "read" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith(["read"]);
  });

  it("commits active-tools cache key after applying", async () => {
    const { handler, session } = makeHandler({
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(session.commitActiveToolsCacheKey).toHaveBeenCalled();
  });

  it("skips setActive when cache key is unchanged", async () => {
    const { handler, session, toolRegistry } = makeHandler({
      session: { shouldUpdateActiveTools: vi.fn().mockReturnValue(false) },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).not.toHaveBeenCalled();
    expect(session.commitActiveToolsCacheKey).not.toHaveBeenCalled();
  });

  it("returns empty object when prompt cache is unchanged", async () => {
    const { handler, session } = makeHandler({
      session: { shouldUpdatePromptState: vi.fn().mockReturnValue(false) },
    });
    const result = await handler.handle(makeEvent(), makeCtx());
    expect(result).toEqual({});
    expect(session.commitPromptStateCacheKey).not.toHaveBeenCalled();
  });

  it("commits prompt-state cache key and processes prompt when cache is new", async () => {
    const { handler, session } = makeHandler();
    await handler.handle(makeEvent(), makeCtx());
    expect(session.commitPromptStateCacheKey).toHaveBeenCalled();
  });

  it("stores resolved skill entries on the session", async () => {
    const { handler, session } = makeHandler();
    await handler.handle(makeEvent(), makeCtx());
    expect(session.setActiveSkillEntries).toHaveBeenCalledWith(expect.any(Array));
  });

  it("returns modified systemPrompt when prompt changes", async () => {
    const systemPrompt = `You are an assistant.\n\nAvailable tools:\n- read\n- write\n`;
    const { handler } = makeHandler();
    const result = await handler.handle(makeEvent(systemPrompt), makeCtx());
    expect(result).toHaveProperty("systemPrompt");
  });

  it("returns empty object when systemPrompt is unchanged", async () => {
    const prompt = "No tools section here.";
    const { handler } = makeHandler();
    const result = await handler.handle(makeEvent(prompt), makeCtx());
    expect(result).toEqual({});
  });
});
