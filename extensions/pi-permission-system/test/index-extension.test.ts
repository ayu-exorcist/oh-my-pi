import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const runtime = {
    agentDir: "/agent",
    forwardingDir: "/forwarding",
    subagentSessionsDir: "/subagents",
    config: { yoloMode: false, permissionReviewLog: true, debugLog: false },
    lastKnownActiveAgentName: "coder",
    permissionManager: {
      checkPermission: vi.fn(() => ({ action: "allow", source: "config" })),
      getToolPermission: vi.fn(() => "ask"),
      getComposedConfigRules: vi.fn(() => []),
    },
    sessionRules: {
      getRuleset: vi.fn(() => [{ surface: "bash", pattern: "git *", action: "allow" }]),
    },
    runtimeContext: { sessionId: "session-1" },
    writeReviewLog: vi.fn(),
    writeDebugLog: vi.fn(),
  };

  return {
    runtime,
    refreshExtensionConfig: vi.fn(),
    logResolvedConfigPaths: vi.fn(),
    saveExtensionConfig: vi.fn(),
    registerPermissionSystemCommand: vi.fn(),
    registerPermissionRpcHandlers: vi.fn(() => ({
      unsubCheck: vi.fn(),
      unsubPrompt: vi.fn(),
    })),
    emitReadyEvent: vi.fn(),
    publishPermissionsService: vi.fn(),
    unpublishPermissionsService: vi.fn(),
    subscribeSubagentLifecycle: vi.fn(() => vi.fn()),
    createSessionLogger: vi.fn(() => ({ log: vi.fn() })),
    isSubagentExecutionContext: vi.fn(() => false),
    canResolveAskPermissionRequest: vi.fn(() => true),
    shouldAutoApprovePermissionState: vi.fn(() => false),
    requestPermissionDecisionFromUi: vi.fn(),
    buildInputForSurface: vi.fn((_surface: string, value: unknown) => ({ value })),
    lifecycleInstances: [] as Array<{
      handleSessionStart: ReturnType<typeof vi.fn>;
      handleResourcesDiscover: ReturnType<typeof vi.fn>;
      handleSessionShutdown: ReturnType<typeof vi.fn>;
    }>,
    agentPrepInstances: [] as Array<{ handle: ReturnType<typeof vi.fn> }>,
    gateInstances: [] as Array<{
      handleInput: ReturnType<typeof vi.fn>;
      handleToolCall: ReturnType<typeof vi.fn>;
    }>,
    permissionSessionArgs: [] as unknown[][],
    forwardingManagerArgs: [] as unknown[][],
    permissionPrompterArgs: [] as unknown[],
    registryInstances: [] as Array<{
      register: ReturnType<typeof vi.fn>;
      unregister: ReturnType<typeof vi.fn>;
    }>,
  };
});

vi.mock("../src/runtime", () => ({
  createExtensionRuntime: () => mocks.runtime,
  refreshExtensionConfig: mocks.refreshExtensionConfig,
  logResolvedConfigPaths: mocks.logResolvedConfigPaths,
  saveExtensionConfig: mocks.saveExtensionConfig,
}));

vi.mock("../src/config-modal", () => ({
  registerPermissionSystemCommand: mocks.registerPermissionSystemCommand,
}));

vi.mock("../src/config-paths", () => ({
  getGlobalConfigPath: (agentDir: string) => `${agentDir}/config.json`,
}));

vi.mock("../src/permission-event-rpc", () => ({
  registerPermissionRpcHandlers: mocks.registerPermissionRpcHandlers,
}));

vi.mock("../src/permission-events", () => ({
  emitReadyEvent: mocks.emitReadyEvent,
}));

vi.mock("../src/service", () => ({
  publishPermissionsService: mocks.publishPermissionsService,
  unpublishPermissionsService: mocks.unpublishPermissionsService,
}));

vi.mock("../src/session-logger", () => ({
  createSessionLogger: mocks.createSessionLogger,
}));

vi.mock("../src/subagent-context", () => ({
  isSubagentExecutionContext: mocks.isSubagentExecutionContext,
}));

vi.mock("../src/subagent-lifecycle-events", () => ({
  subscribeSubagentLifecycle: mocks.subscribeSubagentLifecycle,
}));

vi.mock("../src/yolo-mode", () => ({
  canResolveAskPermissionRequest: mocks.canResolveAskPermissionRequest,
  shouldAutoApprovePermissionState: mocks.shouldAutoApprovePermissionState,
}));

vi.mock("../src/permission-dialog", () => ({
  requestPermissionDecisionFromUi: mocks.requestPermissionDecisionFromUi,
}));

vi.mock("../src/input-normalizer", () => ({
  buildInputForSurface: mocks.buildInputForSurface,
}));

vi.mock("../src/subagent-registry", () => ({
  SubagentSessionRegistry: class {
    register = vi.fn();
    unregister = vi.fn();
    constructor() {
      mocks.registryInstances.push(this);
    }
  },
}));

vi.mock("../src/permission-prompter", () => ({
  PermissionPrompter: class {
    prompt = vi.fn(() => ({ approved: true }));
    constructor(deps: { getConfig: () => unknown }) {
      mocks.permissionPrompterArgs.push(deps);
      deps.getConfig();
    }
  },
}));

vi.mock("../src/forwarding-manager", () => ({
  ForwardingManager: class {
    constructor(...args: unknown[]) {
      mocks.forwardingManagerArgs.push(args);
    }
  },
}));

vi.mock("../src/permission-session", () => ({
  PermissionSession: class {
    constructor(...args: unknown[]) {
      mocks.permissionSessionArgs.push(args);
    }
  },
}));

vi.mock("../src/handlers", () => ({
  SessionLifecycleHandler: class {
    handleSessionStart = vi.fn();
    handleResourcesDiscover = vi.fn();
    handleSessionShutdown = vi.fn();
    constructor(_session: unknown, onShutdown: () => void) {
      this.handleSessionShutdown.mockImplementation(onShutdown);
      mocks.lifecycleInstances.push(this);
    }
  },
  AgentPrepHandler: class {
    handle = vi.fn();
    constructor(
      _session: unknown,
      toolRegistry: { getAll: () => unknown; setActive: (names: string[]) => void },
    ) {
      toolRegistry.getAll();
      toolRegistry.setActive(["bash"]);
      mocks.agentPrepInstances.push(this);
    }
  },
  PermissionGateHandler: class {
    handleInput = vi.fn();
    handleToolCall = vi.fn();
    constructor(
      _session: unknown,
      _events: unknown,
      toolRegistry: { getAll: () => unknown; setActive: (names: string[]) => void },
    ) {
      toolRegistry.getAll();
      toolRegistry.setActive(["read"]);
      mocks.gateInstances.push(this);
    }
  },
}));

type PiStub = {
  events: { emit: ReturnType<typeof vi.fn> };
  on: (name: string, handler: (...args: unknown[]) => unknown) => void;
  getAllTools: ReturnType<typeof vi.fn>;
  setActiveTools: ReturnType<typeof vi.fn>;
};

function createPiStub(): { pi: PiStub; handlers: Map<string, (...args: unknown[]) => unknown> } {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    pi: {
      events: { emit: vi.fn() },
      on(name, handler) {
        handlers.set(name, handler);
      },
      getAllTools: vi.fn(() => [{ name: "bash" }]),
      setActiveTools: vi.fn(),
    },
  };
}

describe("pi-permission-system extension entrypoint", () => {
  it("wires commands, services, lifecycle handlers, gates, and cleanup", async () => {
    vi.resetModules();
    const { default: extension } = await import("../src/index");
    const { pi, handlers } = createPiStub();

    extension(pi as never);

    expect(mocks.refreshExtensionConfig).toHaveBeenCalledWith(mocks.runtime);
    expect(mocks.registerPermissionSystemCommand).toHaveBeenCalledOnce();
    expect(mocks.registerPermissionRpcHandlers).toHaveBeenCalledOnce();
    expect(mocks.publishPermissionsService).toHaveBeenCalledOnce();
    expect(mocks.subscribeSubagentLifecycle).toHaveBeenCalledOnce();
    expect(mocks.emitReadyEvent).toHaveBeenCalledWith(pi.events);

    const commandController = mocks.registerPermissionSystemCommand.mock.calls[0]?.[1] as {
      getConfig: () => unknown;
      setConfig: (next: unknown, ctx: unknown) => unknown;
      getConfigPath: () => string;
      getComposedRules: () => unknown;
    };
    expect(commandController.getConfig()).toBe(mocks.runtime.config);
    commandController.setConfig({ debugLog: true }, { hasUI: true });
    expect(mocks.saveExtensionConfig).toHaveBeenCalledWith(
      mocks.runtime,
      { debugLog: true },
      { hasUI: true },
    );
    expect(commandController.getConfigPath()).toBe("/agent/config.json");
    commandController.getComposedRules();
    expect(mocks.runtime.permissionManager.getComposedConfigRules).toHaveBeenCalledWith("coder");
    mocks.runtime.lastKnownActiveAgentName = null;
    commandController.getComposedRules();
    expect(mocks.runtime.permissionManager.getComposedConfigRules).toHaveBeenCalledWith(undefined);

    const rpcDeps = mocks.registerPermissionRpcHandlers.mock.calls[0]?.[1] as {
      getPermissionManager: () => unknown;
      getSessionRules: () => unknown;
      getRuntimeContext: () => unknown;
      writeReviewLog: (event: unknown) => unknown;
    };
    expect(rpcDeps.getPermissionManager()).toBe(mocks.runtime.permissionManager);
    expect(rpcDeps.getSessionRules()).toEqual([
      { surface: "bash", pattern: "git *", action: "allow" },
    ]);
    expect(rpcDeps.getRuntimeContext()).toBe(mocks.runtime.runtimeContext);
    rpcDeps.writeReviewLog({ type: "review" });
    expect(mocks.runtime.writeReviewLog).toHaveBeenCalledWith({ type: "review" });

    const service = mocks.publishPermissionsService.mock.calls[0]?.[0] as {
      checkPermission: (surface: string, value: unknown, agentName?: string) => unknown;
      registerSubagentSession: (sessionKey: string, info: unknown) => void;
      unregisterSubagentSession: (sessionKey: string) => void;
      getToolPermission: (toolName: string, agentName?: string) => unknown;
    };
    expect(service.checkPermission("bash", "git status", "coder")).toEqual({
      action: "allow",
      source: "config",
    });
    expect(mocks.buildInputForSurface).toHaveBeenCalledWith("bash", "git status");
    expect(mocks.runtime.permissionManager.checkPermission).toHaveBeenCalledWith(
      "bash",
      { value: "git status" },
      "coder",
      [{ surface: "bash", pattern: "git *", action: "allow" }],
    );
    service.registerSubagentSession("child", { parentSessionId: "parent" });
    service.unregisterSubagentSession("child");
    expect(mocks.registryInstances[0]?.register).toHaveBeenCalledWith("child", {
      parentSessionId: "parent",
    });
    expect(mocks.registryInstances[0]?.unregister).toHaveBeenCalledWith("child");
    expect(service.getToolPermission("bash", "coder")).toBe("ask");

    const sessionDeps = mocks.permissionSessionArgs[0]?.[3] as {
      refreshExtensionConfig: (ctx: unknown) => unknown;
      logResolvedConfigPaths: () => unknown;
      getConfig: () => unknown;
      canRequestPermissionConfirmation: (ctx: { hasUI: boolean }) => unknown;
      promptPermission: (ctx: unknown, details: unknown) => unknown;
    };
    sessionDeps.refreshExtensionConfig({ hasUI: true });
    expect(mocks.refreshExtensionConfig).toHaveBeenLastCalledWith(mocks.runtime, { hasUI: true });
    sessionDeps.logResolvedConfigPaths();
    expect(mocks.logResolvedConfigPaths).toHaveBeenCalledWith(mocks.runtime);
    expect(sessionDeps.getConfig()).toBe(mocks.runtime.config);
    expect(sessionDeps.canRequestPermissionConfirmation({ hasUI: true })).toBe(true);
    expect(mocks.canResolveAskPermissionRequest).toHaveBeenCalledWith({
      config: mocks.runtime.config,
      hasUI: true,
      isSubagent: false,
    });
    expect(sessionDeps.promptPermission({ hasUI: true }, { surface: "bash" })).toEqual({
      approved: true,
    });

    const forwardingDeps = mocks.forwardingManagerArgs[0]?.[1] as {
      logger: {
        writeReviewLog: (event: unknown) => unknown;
        writeDebugLog: (event: unknown) => unknown;
      };
      writeReviewLog: (event: unknown) => unknown;
      shouldAutoApprove: () => boolean;
    };
    forwardingDeps.logger.writeReviewLog({ type: "forward-review" });
    forwardingDeps.logger.writeDebugLog({ type: "forward-debug" });
    forwardingDeps.writeReviewLog({ type: "forward-top" });
    expect(forwardingDeps.shouldAutoApprove()).toBe(false);
    expect(mocks.shouldAutoApprovePermissionState).toHaveBeenCalledWith(
      "ask",
      mocks.runtime.config,
    );

    handlers.get("session_start")?.({ type: "session_start" }, { hasUI: true });
    handlers.get("resources_discover")?.({ type: "resources_discover" });
    handlers.get("before_agent_start")?.({ agentName: "coder" }, { hasUI: true });
    handlers.get("input")?.({ input: "hi" }, { hasUI: true });
    handlers.get("tool_call")?.({ toolName: "bash" }, { hasUI: true });
    expect(mocks.lifecycleInstances[0]?.handleSessionStart).toHaveBeenCalledOnce();
    expect(mocks.lifecycleInstances[0]?.handleResourcesDiscover).toHaveBeenCalledOnce();
    expect(mocks.agentPrepInstances[0]?.handle).toHaveBeenCalledOnce();
    expect(mocks.gateInstances[0]?.handleInput).toHaveBeenCalledOnce();
    expect(mocks.gateInstances[0]?.handleToolCall).toHaveBeenCalledOnce();

    handlers.get("session_shutdown")?.();
    const rpcHandles = mocks.registerPermissionRpcHandlers.mock.results[0]?.value as {
      unsubCheck: ReturnType<typeof vi.fn>;
      unsubPrompt: ReturnType<typeof vi.fn>;
    };
    expect(rpcHandles.unsubCheck).toHaveBeenCalledOnce();
    expect(rpcHandles.unsubPrompt).toHaveBeenCalledOnce();
    expect(mocks.subscribeSubagentLifecycle.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(mocks.unpublishPermissionsService).toHaveBeenCalledOnce();
  });
});
