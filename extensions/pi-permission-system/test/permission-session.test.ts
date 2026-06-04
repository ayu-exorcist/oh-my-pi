import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

const {
  mockGetActiveAgentName,
  mockGetActiveAgentNameFromSystemPrompt,
  mockCreatePermissionManagerForCwd,
} = vi.hoisted(() => ({
  mockGetActiveAgentName: vi.fn<(ctx: ExtensionContext) => string | null>(),
  mockGetActiveAgentNameFromSystemPrompt: vi.fn<(systemPrompt?: string) => string | null>(),
  mockCreatePermissionManagerForCwd: vi.fn(),
}));

vi.mock("../src/active-agent", () => ({
  getActiveAgentName: mockGetActiveAgentName,
  getActiveAgentNameFromSystemPrompt: mockGetActiveAgentNameFromSystemPrompt,
}));

vi.mock("../src/runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/runtime")>();
  return {
    ...original,
    createPermissionManagerForCwd: mockCreatePermissionManagerForCwd,
  };
});

// ── Test helpers ───────────────────────────────────────────────────────────

import type { ExtensionPaths } from "#src/extension-paths";
import type { ForwardingController } from "#src/forwarding-manager";
import type { PermissionManager } from "#src/permission-manager";
import { PermissionSession, type PermissionSessionRuntimeDeps } from "#src/permission-session";
import type { SessionLogger } from "#src/session-logger";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";

function makeSkillEntry(name: string, overrides: Partial<SkillPromptEntry> = {}): SkillPromptEntry {
  return {
    name,
    description: `${name} skill`,
    location: `/${name}/SKILL.md`,
    state: "allow",
    normalizedLocation: `/${name}/SKILL.md`,
    normalizedBaseDir: `/${name}`,
    ...overrides,
  };
}

function makePaths(overrides: Partial<ExtensionPaths> = {}): ExtensionPaths {
  return {
    agentDir: "/test/agent",
    sessionsDir: "/test/agent/ayu/sessions",
    subagentSessionsDir: "/test/agent/ayu/subagent-sessions",
    forwardingDir: "/test/agent/ayu/sessions/permission-forwarding",
    globalLogsDir: "/test/agent/ayu/extensions/pi-permission-system/logs",
    piInfrastructureDirs: ["/test/agent", "/test/agent/ayu", "/test/agent/ayu/git"],
    ...overrides,
  };
}

function makeLogger(): SessionLogger {
  return {
    debug: vi.fn(),
    review: vi.fn(),
    warn: vi.fn(),
  };
}

function makeRuntimeDeps(): PermissionSessionRuntimeDeps {
  return {
    refreshExtensionConfig: vi.fn(),
    logResolvedConfigPaths: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    canRequestPermissionConfirmation: vi.fn().mockReturnValue(true),
    promptPermission: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
  };
}

function makeForwarding(): ForwardingController {
  return {
    start: vi.fn(),
    stop: vi.fn(),
  };
}

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

function makePermissionManager(overrides: Partial<PermissionManager> = {}): PermissionManager {
  return {
    checkPermission: vi.fn().mockReturnValue({
      state: "allow",
      toolName: "read",
      source: "tool",
      origin: "builtin",
    }),
    getToolPermission: vi.fn().mockReturnValue("allow"),
    getConfigIssues: vi.fn().mockReturnValue([]),
    getPolicyCacheStamp: vi.fn().mockReturnValue("stamp-1"),
    getComposedConfigRules: vi.fn().mockReturnValue([]),
    getResolvedPolicyPaths: vi.fn().mockReturnValue({}),
    ...overrides,
  } as unknown as PermissionManager;
}

function createSession(overrides?: {
  paths?: Partial<ExtensionPaths>;
  logger?: SessionLogger;
  forwarding?: ForwardingController;
  runtimeDeps?: PermissionSessionRuntimeDeps;
}): {
  session: PermissionSession;
  paths: ExtensionPaths;
  logger: SessionLogger;
  forwarding: ForwardingController;
  runtimeDeps: PermissionSessionRuntimeDeps;
} {
  const paths = makePaths(overrides?.paths);
  const logger = overrides?.logger ?? makeLogger();
  const forwarding = overrides?.forwarding ?? makeForwarding();
  const runtimeDeps = overrides?.runtimeDeps ?? makeRuntimeDeps();
  const session = new PermissionSession(paths, logger, forwarding, runtimeDeps);
  return { session, paths, logger, forwarding, runtimeDeps };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetActiveAgentName.mockReset();
  mockGetActiveAgentNameFromSystemPrompt.mockReset();
  mockCreatePermissionManagerForCwd.mockReset();

  // Default: createPermissionManagerForCwd returns a fresh mock PM
  mockCreatePermissionManagerForCwd.mockReturnValue(makePermissionManager());
  mockGetActiveAgentName.mockReturnValue(null);
  mockGetActiveAgentNameFromSystemPrompt.mockReturnValue(null);
});

describe("PermissionSession", () => {
  describe("constructor and delegation", () => {
    it("delegates checkPermission to internal PermissionManager", () => {
      const pm = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      const result = session.checkPermission("bash", { command: "ls" });

      expect(pm.checkPermission).toHaveBeenCalledWith(
        "bash",
        { command: "ls" },
        undefined,
        undefined,
      );
      expect(result.state).toBe("allow");
    });

    it("delegates getToolPermission to internal PermissionManager", () => {
      const pm = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      const result = session.getToolPermission("read");

      expect(pm.getToolPermission).toHaveBeenCalledWith("read", undefined);
      expect(result).toBe("allow");
    });

    it("delegates getConfigIssues to internal PermissionManager", () => {
      const pm = makePermissionManager({
        getConfigIssues: vi.fn().mockReturnValue(["issue1"]),
      });
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      expect(session.getConfigIssues("agent1")).toEqual(["issue1"]);
      expect(pm.getConfigIssues).toHaveBeenCalledWith("agent1");
    });

    it("delegates getPolicyCacheStamp to internal PermissionManager", () => {
      const pm = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm);
      const { session } = createSession();

      expect(session.getPolicyCacheStamp("agent1")).toBe("stamp-1");
      expect(pm.getPolicyCacheStamp).toHaveBeenCalledWith("agent1");
    });

    it("delegates getSessionRuleset to internal SessionRules", () => {
      const { session } = createSession();
      const rules = session.getSessionRuleset();
      expect(rules).toEqual([]);
    });

    it("delegates approveSessionRule to internal SessionRules", () => {
      const { session } = createSession();
      session.approveSessionRule("bash", "/usr/bin/*");
      const rules = session.getSessionRuleset();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        surface: "bash",
        pattern: "/usr/bin/*",
        action: "allow",
      });
    });
  });

  describe("activate and deactivate", () => {
    it("stores the context on activate", () => {
      const { session, forwarding } = createSession();
      const ctx = makeCtx();

      session.activate(ctx);

      expect(forwarding.start).toHaveBeenCalledWith(ctx);
    });

    it("clears context on deactivate", () => {
      const { session, forwarding } = createSession();
      session.activate(makeCtx());
      session.deactivate();

      expect(forwarding.stop).toHaveBeenCalled();
    });
  });

  describe("resetForNewSession", () => {
    it("creates a new PermissionManager for the context cwd", () => {
      const pm2 = makePermissionManager({
        checkPermission: vi.fn().mockReturnValue({
          state: "deny",
          toolName: "bash",
          source: "bash",
          origin: "global",
        }),
      });
      mockCreatePermissionManagerForCwd.mockReturnValue(pm2);
      const { session } = createSession();
      const ctx = makeCtx({ cwd: "/new/project" });

      session.resetForNewSession(ctx);

      expect(mockCreatePermissionManagerForCwd).toHaveBeenCalledWith("/test/agent", "/new/project");
      // Verify the new PM is used for subsequent calls
      const result = session.checkPermission("bash", { command: "rm" });
      expect(result.state).toBe("deny");
    });

    it("clears cache keys", () => {
      const { session } = createSession();
      session.commitActiveToolsCacheKey("key-1");
      session.commitPromptStateCacheKey("key-2");
      expect(session.shouldUpdateActiveTools("key-1")).toBe(false);
      expect(session.shouldUpdatePromptState("key-2")).toBe(false);

      session.resetForNewSession(makeCtx());

      // After reset, same keys should be treated as new
      expect(session.shouldUpdateActiveTools("key-1")).toBe(true);
      expect(session.shouldUpdatePromptState("key-2")).toBe(true);
    });

    it("clears skill entries", () => {
      const { session } = createSession();
      session.setActiveSkillEntries([makeSkillEntry("test")]);
      expect(session.getActiveSkillEntries()).toHaveLength(1);

      session.resetForNewSession(makeCtx());

      expect(session.getActiveSkillEntries()).toEqual([]);
    });

    it("starts forwarding with the new context", () => {
      const { session, forwarding } = createSession();
      const ctx = makeCtx();

      session.resetForNewSession(ctx);

      expect(forwarding.start).toHaveBeenCalledWith(ctx);
    });

    it("activates the new context", () => {
      const { session } = createSession();
      const ctx = makeCtx();

      session.resetForNewSession(ctx);

      // Verify context is stored by calling resolveAgentName which needs it
      mockGetActiveAgentName.mockReturnValue("test-agent");
      const name = session.resolveAgentName(ctx);
      expect(name).toBe("test-agent");
    });
  });

  describe("shutdown", () => {
    it("clears session rules", () => {
      const { session } = createSession();
      session.approveSessionRule("bash", "*");
      expect(session.getSessionRuleset()).toHaveLength(1);

      session.shutdown();

      expect(session.getSessionRuleset()).toEqual([]);
    });

    it("clears cache keys", () => {
      const { session } = createSession();
      session.commitActiveToolsCacheKey("k1");
      session.commitPromptStateCacheKey("k2");

      session.shutdown();

      expect(session.shouldUpdateActiveTools("k1")).toBe(true);
      expect(session.shouldUpdatePromptState("k2")).toBe(true);
    });

    it("clears skill entries", () => {
      const { session } = createSession();
      session.setActiveSkillEntries([makeSkillEntry("s")]);

      session.shutdown();

      expect(session.getActiveSkillEntries()).toEqual([]);
    });

    it("stops forwarding and deactivates context", () => {
      const { session, forwarding } = createSession();
      session.activate(makeCtx());

      session.shutdown();

      expect(forwarding.stop).toHaveBeenCalled();
    });
  });

  describe("cache key methods", () => {
    it("shouldUpdateActiveTools returns true for new key", () => {
      const { session } = createSession();
      expect(session.shouldUpdateActiveTools("key-1")).toBe(true);
    });

    it("shouldUpdateActiveTools returns false for committed key", () => {
      const { session } = createSession();
      session.commitActiveToolsCacheKey("key-1");
      expect(session.shouldUpdateActiveTools("key-1")).toBe(false);
    });

    it("shouldUpdateActiveTools returns true for different key", () => {
      const { session } = createSession();
      session.commitActiveToolsCacheKey("key-1");
      expect(session.shouldUpdateActiveTools("key-2")).toBe(true);
    });

    it("shouldUpdatePromptState returns true for new key", () => {
      const { session } = createSession();
      expect(session.shouldUpdatePromptState("key-1")).toBe(true);
    });

    it("shouldUpdatePromptState returns false for committed key", () => {
      const { session } = createSession();
      session.commitPromptStateCacheKey("key-1");
      expect(session.shouldUpdatePromptState("key-1")).toBe(false);
    });
  });

  describe("skill entries", () => {
    it("get/set skill entries", () => {
      const { session } = createSession();
      const entries = [makeSkillEntry("a"), makeSkillEntry("b")];
      session.setActiveSkillEntries(entries);
      expect(session.getActiveSkillEntries()).toEqual(entries);
    });
  });

  describe("resolveAgentName", () => {
    it("returns name from session context", () => {
      mockGetActiveAgentName.mockReturnValue("ctx-agent");
      const { session } = createSession();
      const ctx = makeCtx();

      expect(session.resolveAgentName(ctx)).toBe("ctx-agent");
    });

    it("falls back to system prompt", () => {
      mockGetActiveAgentName.mockReturnValue(null);
      mockGetActiveAgentNameFromSystemPrompt.mockReturnValue("prompt-agent");
      const { session } = createSession();
      const ctx = makeCtx();

      expect(session.resolveAgentName(ctx, "system prompt")).toBe("prompt-agent");
    });

    it("falls back to last known name", () => {
      const { session } = createSession();
      const ctx = makeCtx();

      // First call sets name
      mockGetActiveAgentName.mockReturnValue("first-agent");
      session.resolveAgentName(ctx);

      // Second call with no name resolves to last known
      mockGetActiveAgentName.mockReturnValue(null);
      mockGetActiveAgentNameFromSystemPrompt.mockReturnValue(null);
      expect(session.resolveAgentName(ctx)).toBe("first-agent");
    });

    it("exposes lastKnownActiveAgentName", () => {
      const { session } = createSession();
      expect(session.lastKnownActiveAgentName).toBeNull();

      mockGetActiveAgentName.mockReturnValue("named");
      session.resolveAgentName(makeCtx());
      expect(session.lastKnownActiveAgentName).toBe("named");
    });
  });

  describe("infrastructure paths", () => {
    it("getInfrastructureDirs returns paths from ExtensionPaths", () => {
      const { session } = createSession();
      expect(session.getInfrastructureDirs()).toEqual([
        "/test/agent",
        "/test/agent/ayu",
        "/test/agent/ayu/git",
      ]);
    });

    it("getInfrastructureReadPaths returns config paths", () => {
      const runtimeDeps = makeRuntimeDeps();
      (runtimeDeps.getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        piInfrastructureReadPaths: ["/extra/path"],
      });
      const { session } = createSession({ runtimeDeps });
      expect(session.getInfrastructureReadPaths()).toEqual(["/extra/path"]);
    });

    it("getInfrastructureReadPaths returns empty when config omits the field", () => {
      const { session } = createSession();
      expect(session.getInfrastructureReadPaths()).toEqual([]);
    });
  });

  describe("config delegation", () => {
    it("refreshConfig delegates to runtimeDeps", () => {
      const { session, runtimeDeps } = createSession();
      const ctx = makeCtx();
      session.refreshConfig(ctx);
      expect(runtimeDeps.refreshExtensionConfig).toHaveBeenCalledWith(ctx);
    });

    it("logResolvedConfigPaths delegates to runtimeDeps", () => {
      const { session, runtimeDeps } = createSession();
      session.logResolvedConfigPaths();
      expect(runtimeDeps.logResolvedConfigPaths).toHaveBeenCalled();
    });

    it("config getter delegates to runtimeDeps.getConfig", () => {
      const runtimeDeps = makeRuntimeDeps();
      const fakeConfig = { debugLog: true };
      (runtimeDeps.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(fakeConfig);
      const { session } = createSession({ runtimeDeps });
      expect(session.config).toBe(fakeConfig);
    });
  });

  describe("reload", () => {
    it("recreates PermissionManager for current context cwd", () => {
      const { session } = createSession();
      const ctx = makeCtx({ cwd: "/project" });
      session.activate(ctx);

      const pm2 = makePermissionManager();
      mockCreatePermissionManagerForCwd.mockReturnValue(pm2);

      session.reload();

      expect(mockCreatePermissionManagerForCwd).toHaveBeenCalledWith("/test/agent", "/project");
    });

    it("clears caches and skill entries", () => {
      const { session } = createSession();
      session.commitActiveToolsCacheKey("k1");
      session.commitPromptStateCacheKey("k2");
      session.setActiveSkillEntries([makeSkillEntry("s")]);

      session.reload();

      expect(session.shouldUpdateActiveTools("k1")).toBe(true);
      expect(session.shouldUpdatePromptState("k2")).toBe(true);
      expect(session.getActiveSkillEntries()).toEqual([]);
    });
  });

  describe("getRuntimeContext", () => {
    it("returns null before activation", () => {
      const { session } = createSession();
      expect(session.getRuntimeContext()).toBeNull();
    });

    it("returns context after activation", () => {
      const { session } = createSession();
      const ctx = makeCtx();
      session.activate(ctx);
      expect(session.getRuntimeContext()).toBe(ctx);
    });

    it("returns null after deactivation", () => {
      const { session } = createSession();
      session.activate(makeCtx());
      session.deactivate();
      expect(session.getRuntimeContext()).toBeNull();
    });
  });

  describe("canPrompt", () => {
    it("delegates to runtimeDeps.canRequestPermissionConfirmation", () => {
      const { session, runtimeDeps } = createSession();
      const ctx = makeCtx();

      const result = session.canPrompt(ctx);

      expect(runtimeDeps.canRequestPermissionConfirmation).toHaveBeenCalledWith(ctx);
      expect(result).toBe(true);
    });

    it("returns false when runtimeDeps says no", () => {
      const runtimeDeps = makeRuntimeDeps();
      (runtimeDeps.canRequestPermissionConfirmation as ReturnType<typeof vi.fn>).mockReturnValue(
        false,
      );
      const { session } = createSession({ runtimeDeps });

      expect(session.canPrompt(makeCtx())).toBe(false);
    });
  });

  describe("prompt", () => {
    it("delegates to runtimeDeps.promptPermission", async () => {
      const { session, runtimeDeps } = createSession();
      const ctx = makeCtx();
      const details = {
        requestId: "req-1",
        source: "tool_call" as const,
        agentName: null,
        message: "Allow?",
      };

      const result = await session.prompt(ctx, details);

      expect(runtimeDeps.promptPermission).toHaveBeenCalledWith(ctx, details);
      expect(result).toEqual({ approved: true, state: "approved" });
    });
  });

  describe("createPermissionRequestId", () => {
    it("starts with the given prefix", () => {
      const { session } = createSession();
      const id = session.createPermissionRequestId("skill-input");
      expect(id.startsWith("skill-input-")).toBe(true);
    });

    it("generates unique IDs on repeated calls", () => {
      const { session } = createSession();
      const id1 = session.createPermissionRequestId("test");
      const id2 = session.createPermissionRequestId("test");
      expect(id1).not.toBe(id2);
    });
  });
});
