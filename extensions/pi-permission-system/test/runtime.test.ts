import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── logger stub ────────────────────────────────────────────────────────────
const {
  mockLoggerDebug,
  mockLoggerReview,
  mockCreateLogger,
  mockLoadAndMergeConfigs,
  mockSyncPermissionSystemStatus,
  mockBuildResolvedConfigLogEntry,
  mockDiscoverGlobalNodeModulesRoot,
} = vi.hoisted(() => ({
  mockLoggerDebug:
    vi.fn<(event: string, details?: Record<string, unknown>) => string | undefined>(),
  mockLoggerReview:
    vi.fn<(event: string, details?: Record<string, unknown>) => string | undefined>(),
  mockCreateLogger: vi.fn(),
  mockLoadAndMergeConfigs: vi.fn(),
  mockSyncPermissionSystemStatus: vi.fn(),
  mockBuildResolvedConfigLogEntry: vi.fn(),
  mockDiscoverGlobalNodeModulesRoot: vi.fn<() => string | null>(),
}));

vi.mock("../src/logging", () => ({
  createPermissionSystemLogger: mockCreateLogger,
}));

vi.mock("../src/permission-manager", () => ({
  PermissionManager: vi.fn(),
}));

vi.mock("../src/config-loader", () => ({
  loadAndMergeConfigs: mockLoadAndMergeConfigs,
  loadUnifiedConfig: vi.fn().mockReturnValue({ config: {} }),
}));

vi.mock("../src/status", () => ({
  PERMISSION_SYSTEM_STATUS_KEY: "permission-system",
  syncPermissionSystemStatus: mockSyncPermissionSystemStatus,
  getPermissionSystemStatus: vi.fn(),
}));

vi.mock("../src/config-reporter", () => ({
  buildResolvedConfigLogEntry: mockBuildResolvedConfigLogEntry,
}));

vi.mock("../src/forwarded-permissions/polling", () => ({
  processForwardedPermissionRequests: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/subagent-context", () => ({
  isSubagentExecutionContext: vi.fn().mockReturnValue(false),
}));

vi.mock("../src/node-modules-discovery", () => ({
  discoverGlobalNodeModulesRoot: mockDiscoverGlobalNodeModulesRoot,
}));

vi.mock("../src/session-rules", () => ({
  SessionRules: vi.fn(),
  deriveApprovalPattern: vi.fn(),
}));

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getGlobalConfigPath,
  getGlobalLogsDir,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
  getProjectConfigPath,
} from "#src/config-paths";
import { DEFAULT_EXTENSION_CONFIG, normalizePermissionSystemConfig } from "#src/extension-config";
import { PermissionManager } from "#src/permission-manager";
import {
  createExtensionRuntime,
  createPermissionManagerForCwd,
  derivePiProjectPaths,
  logResolvedConfigPaths,
  refreshExtensionConfig,
  saveExtensionConfig,
} from "#src/runtime";

function makeRuntime() {
  mockCreateLogger.mockReturnValue({
    debug: mockLoggerDebug,
    review: mockLoggerReview,
  });
  return createExtensionRuntime({ agentDir: "/test/agent" });
}

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: false,
    ui: { notify: vi.fn(), setStatus: vi.fn() },
    sessionManager: { getEntries: vi.fn(), addEntry: vi.fn() },
    ...overrides,
  } as unknown as ExtensionContext;
}

// ── test suite ─────────────────────────────────────────────────────────────

describe("createExtensionRuntime", () => {
  beforeEach(() => {
    mockLoggerDebug.mockReset();
    mockLoggerDebug.mockReturnValue(undefined);
    mockLoggerReview.mockReset();
    mockLoggerReview.mockReturnValue(undefined);
    mockCreateLogger.mockReset();
    mockCreateLogger.mockReturnValue({
      debug: mockLoggerDebug,
      review: mockLoggerReview,
    });
    mockDiscoverGlobalNodeModulesRoot.mockReset();
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue("/mock/global/node_modules");
  });

  // ── Path derivation ──────────────────────────────────────────────────────

  it("sets agentDir from provided option", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.agentDir).toBe("/test/agent");
  });

  it("derives sessionsDir under the Ayu agent dir", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.sessionsDir).toBe("/test/agent/ayu/sessions");
  });

  it("derives subagentSessionsDir under the Ayu agent dir", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.subagentSessionsDir).toBe("/test/agent/ayu/subagent-sessions");
  });

  it("derives forwardingDir as Ayu sessions/permission-forwarding", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.forwardingDir).toBe("/test/agent/ayu/sessions/permission-forwarding");
  });

  it("derives globalLogsDir via getGlobalLogsDir", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.globalLogsDir).toBe(getGlobalLogsDir("/test/agent"));
  });

  // ── piInfrastructureDirs ─────────────────────────────────────────────────

  it("includes agentDir in piInfrastructureDirs", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.piInfrastructureDirs).toContain("/test/agent");
  });

  it("includes Ayu agentDir and Ayu agentDir/git in piInfrastructureDirs", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.piInfrastructureDirs).toContain("/test/agent/ayu");
    expect(runtime.piInfrastructureDirs).toContain("/test/agent/ayu/git");
  });

  it("includes discovered global node_modules root in piInfrastructureDirs", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.piInfrastructureDirs).toContain("/mock/global/node_modules");
  });

  it("excludes null when discoverGlobalNodeModulesRoot returns null", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    for (const dir of runtime.piInfrastructureDirs) {
      expect(dir).not.toBeNull();
      expect(typeof dir).toBe("string");
    }
  });

  it("omits global node_modules from piInfrastructureDirs when discovery returns null", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    // Only agentDir, Ayu agentDir, and Ayu agentDir/git should be present.
    expect(runtime.piInfrastructureDirs).toHaveLength(3);
    expect(runtime.piInfrastructureDirs).toContain("/test/agent");
    expect(runtime.piInfrastructureDirs).toContain("/test/agent/ayu");
    expect(runtime.piInfrastructureDirs).toContain("/test/agent/ayu/git");
  });

  // ── Default mutable state ────────────────────────────────────────────────

  it("initializes config to DEFAULT_EXTENSION_CONFIG", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.config).toEqual(DEFAULT_EXTENSION_CONFIG);
  });

  it("initializes runtimeContext to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.runtimeContext).toBeNull();
  });

  it("initializes activeSkillEntries to empty array", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.activeSkillEntries).toEqual([]);
  });

  it("initializes lastKnownActiveAgentName to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastKnownActiveAgentName).toBeNull();
  });

  it("initializes lastActiveToolsCacheKey to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastActiveToolsCacheKey).toBeNull();
  });

  it("initializes lastPromptStateCacheKey to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastPromptStateCacheKey).toBeNull();
  });

  it("initializes lastConfigWarning to null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.lastConfigWarning).toBeNull();
  });

  it("creates a sessionRules instance", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    expect(runtime.sessionRules).toBeDefined();
  });

  // ── Mutable state is writable ──────────────────────────────────────────

  it("allows config to be updated", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const newConfig = {
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: false,
    };
    runtime.config = newConfig;
    expect(runtime.config).toEqual(newConfig);
  });

  it("allows runtimeContext to be updated", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockCtx = { hasUI: false } as never;
    runtime.runtimeContext = mockCtx;
    expect(runtime.runtimeContext).toBe(mockCtx);
  });

  // ── Logger is created with runtime-derived paths ─────────────────────────

  it("creates the logger with derived debugLogPath and reviewLogPath", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "runtime-agent-"));
    try {
      const expectedLogsDir = getGlobalLogsDir(agentDir);
      createExtensionRuntime({ agentDir });
      expect(mockCreateLogger).toHaveBeenCalledOnce();
      const opts = mockCreateLogger.mock.calls[0][0] as {
        debugLogPath: string;
        reviewLogPath: string;
        ensureLogsDirectory: () => string | undefined;
      };
      expect(opts.debugLogPath).toContain(expectedLogsDir);
      expect(opts.reviewLogPath).toContain(expectedLogsDir);
      expect(opts.ensureLogsDirectory()).toBeUndefined();
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("passes getConfig that reads current runtime.config", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const opts = mockCreateLogger.mock.calls[0][0] as {
      getConfig: () => typeof DEFAULT_EXTENSION_CONFIG;
    };
    const updatedConfig = {
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: false,
    };
    runtime.config = updatedConfig;
    // getConfig() should reflect the updated value
    expect(opts.getConfig()).toEqual(updatedConfig);
  });

  // ── writeDebugLog delegates to logger.debug ──────────────────────────────

  it("writeDebugLog calls logger.debug with event and details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeDebugLog("test.event", { key: "value" });
    expect(mockLoggerDebug).toHaveBeenCalledWith("test.event", {
      key: "value",
    });
  });

  it("writeDebugLog uses empty object as default details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeDebugLog("test.event");
    expect(mockLoggerDebug).toHaveBeenCalledWith("test.event", {});
  });

  // ── writeReviewLog delegates to logger.review ────────────────────────────

  it("writeReviewLog calls logger.review with event and details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeReviewLog("test.event", { key: "value" });
    expect(mockLoggerReview).toHaveBeenCalledWith("test.event", {
      key: "value",
    });
  });

  it("writeReviewLog uses empty object as default details", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    runtime.writeReviewLog("test.event");
    expect(mockLoggerReview).toHaveBeenCalledWith("test.event", {});
  });

  it("writeReviewLog reports logger warnings", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerReview.mockReturnValueOnce("review log unavailable");

    runtime.writeReviewLog("review.event");

    expect(mockNotify).toHaveBeenCalledWith("review log unavailable", "warning");
  });

  // ── Logging warning reporter ──────────────────────────────────────────────

  it("notifies runtimeContext.ui when logger returns a warning", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerDebug.mockReturnValueOnce("log dir not writable");
    runtime.writeDebugLog("some.event");
    expect(mockNotify).toHaveBeenCalledWith("log dir not writable", "warning");
  });

  it("does not notify when runtimeContext is null", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    mockLoggerDebug.mockReturnValueOnce("a warning");
    // runtimeContext is null, should not throw
    expect(() => runtime.writeDebugLog("some.event")).not.toThrow();
  });

  it("deduplicates logging warnings (same warning not reported twice)", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerDebug
      .mockReturnValueOnce("duplicate warning")
      .mockReturnValueOnce("duplicate warning");
    runtime.writeDebugLog("event.one");
    runtime.writeDebugLog("event.two");
    // The same warning should only be notified once
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith("duplicate warning", "warning");
  });

  it("reports a different warning even after a duplicate has been suppressed", () => {
    const runtime = createExtensionRuntime({ agentDir: "/test/agent" });
    const mockNotify = vi.fn();
    runtime.runtimeContext = {
      hasUI: true,
      ui: { notify: mockNotify },
    } as never;
    mockLoggerDebug
      .mockReturnValueOnce("warning A")
      .mockReturnValueOnce("warning A")
      .mockReturnValueOnce("warning B");
    runtime.writeDebugLog("event.one");
    runtime.writeDebugLog("event.two");
    runtime.writeDebugLog("event.three");
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenNthCalledWith(1, "warning A", "warning");
    expect(mockNotify).toHaveBeenNthCalledWith(2, "warning B", "warning");
  });

  // ── Multiple independent runtimes ─────────────────────────────────────────

  it("two runtimes have independent state", () => {
    const rt1 = createExtensionRuntime({ agentDir: "/agent/a" });
    const rt2 = createExtensionRuntime({ agentDir: "/agent/b" });
    rt1.lastKnownActiveAgentName = "agent-a";
    expect(rt2.lastKnownActiveAgentName).toBeNull();
  });
});

// ── derivePiProjectPaths ───────────────────────────────────────────────────

describe("derivePiProjectPaths", () => {
  it("returns null for null cwd", () => {
    expect(derivePiProjectPaths(null)).toBeNull();
  });

  it("returns null for undefined cwd", () => {
    expect(derivePiProjectPaths(undefined)).toBeNull();
  });

  it("returns null for empty string cwd", () => {
    expect(derivePiProjectPaths("")).toBeNull();
  });

  it("returns projectGlobalConfigPath via getProjectConfigPath", () => {
    const result = derivePiProjectPaths("/my/project");
    expect(result?.projectGlobalConfigPath).toBe(getProjectConfigPath("/my/project"));
  });

  it("returns projectAgentsDir as .pi/ayu/agents under cwd", () => {
    const result = derivePiProjectPaths("/my/project");
    expect(result?.projectAgentsDir).toBe(posix.join("/my/project", ".pi", "ayu", "agents"));
  });
});

// ── createPermissionManagerForCwd ─────────────────────────────────────────

describe("createPermissionManagerForCwd", () => {
  beforeEach(() => {
    // PermissionManager is already mocked as vi.fn() at module scope.
  });

  it("creates a PermissionManager with globalConfigPath from agentDir", () => {
    const MockPM = PermissionManager as ReturnType<typeof vi.fn>;
    MockPM.mockClear();
    createPermissionManagerForCwd("/test/agent", null);
    expect(MockPM).toHaveBeenCalledWith(
      expect.objectContaining({
        globalConfigPath: getGlobalConfigPath("/test/agent"),
      }),
    );
  });

  it("includes projectGlobalConfigPath when cwd is provided", () => {
    const MockPM = PermissionManager as ReturnType<typeof vi.fn>;
    MockPM.mockClear();
    createPermissionManagerForCwd("/test/agent", "/my/project");
    expect(MockPM).toHaveBeenCalledWith(
      expect.objectContaining({
        globalConfigPath: getGlobalConfigPath("/test/agent"),
        projectGlobalConfigPath: getProjectConfigPath("/my/project"),
      }),
    );
  });

  it("excludes projectGlobalConfigPath when cwd is null", () => {
    const MockPM = PermissionManager as ReturnType<typeof vi.fn>;
    MockPM.mockClear();
    createPermissionManagerForCwd("/test/agent", null);
    const callArg = MockPM.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.projectGlobalConfigPath).toBeUndefined();
  });
});

// ── refreshExtensionConfig ────────────────────────────────────────────────

describe("refreshExtensionConfig", () => {
  beforeEach(() => {
    mockLoggerDebug.mockReset().mockReturnValue(undefined);
    mockLoggerReview.mockReset().mockReturnValue(undefined);
    mockLoadAndMergeConfigs.mockReset().mockReturnValue({
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: [],
    });
    mockSyncPermissionSystemStatus.mockReset();
  });

  it("updates runtime.runtimeContext when ctx is provided", () => {
    const runtime = makeRuntime();
    const ctx = makeCtx();
    refreshExtensionConfig(runtime, ctx);
    expect(runtime.runtimeContext).toBe(ctx);
  });

  it("does not override runtimeContext when ctx is omitted", () => {
    const runtime = makeRuntime();
    const existing = makeCtx();
    runtime.runtimeContext = existing;
    refreshExtensionConfig(runtime);
    expect(runtime.runtimeContext).toBe(existing);
  });

  it("updates runtime.config with normalized merged result", () => {
    const runtime = makeRuntime();
    mockLoadAndMergeConfigs.mockReturnValue({
      merged: { debugLog: true, permissionReviewLog: false, yoloMode: false },
      issues: [],
    });
    refreshExtensionConfig(runtime);
    expect(runtime.config.debugLog).toBe(true);
    expect(runtime.config.permissionReviewLog).toBe(false);
  });

  it("calls loadAndMergeConfigs with runtime.agentDir and cwd", () => {
    const runtime = makeRuntime();
    const ctx = makeCtx({ cwd: "/my/project" });
    refreshExtensionConfig(runtime, ctx);
    expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
      "/test/agent",
      "/my/project",
      expect.any(String), // EXTENSION_ROOT
    );
  });

  it("writes config.loaded debug log", () => {
    const runtime = makeRuntime();
    refreshExtensionConfig(runtime);
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "config.loaded",
      expect.objectContaining({ debugLog: false }),
    );
  });

  it("sets lastConfigWarning when issues are present", () => {
    const runtime = makeRuntime();
    mockLoadAndMergeConfigs.mockReturnValue({
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: ["legacy config detected"],
    });
    refreshExtensionConfig(runtime);
    expect(runtime.lastConfigWarning).toBe("legacy config detected");
  });

  it("clears lastConfigWarning when no issues", () => {
    const runtime = makeRuntime();
    runtime.lastConfigWarning = "old warning";
    mockLoadAndMergeConfigs.mockReturnValue({
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: [],
    });
    refreshExtensionConfig(runtime);
    expect(runtime.lastConfigWarning).toBeNull();
  });

  it("notifies UI when a new warning appears and hasUI is true", () => {
    const runtime = makeRuntime();
    const mockNotify = vi.fn();
    const ctx = makeCtx({ hasUI: true, ui: { notify: mockNotify } as never });
    mockLoadAndMergeConfigs.mockReturnValue({
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: ["new warning"],
    });
    refreshExtensionConfig(runtime, ctx);
    expect(mockNotify).toHaveBeenCalledWith("new warning", "warning");
  });

  it("does not re-notify the same warning on subsequent calls", () => {
    const runtime = makeRuntime();
    const mockNotify = vi.fn();
    const ctx = makeCtx({ hasUI: true, ui: { notify: mockNotify } as never });
    mockLoadAndMergeConfigs.mockReturnValue({
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: ["persistent warning"],
    });
    refreshExtensionConfig(runtime, ctx);
    refreshExtensionConfig(runtime, ctx);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("calls syncPermissionSystemStatus when hasUI is true", () => {
    const runtime = makeRuntime();
    const ctx = makeCtx({ hasUI: true });
    refreshExtensionConfig(runtime, ctx);
    expect(mockSyncPermissionSystemStatus).toHaveBeenCalledWith(ctx, expect.any(Object));
  });

  it("does not call syncPermissionSystemStatus when hasUI is false", () => {
    const runtime = makeRuntime();
    const ctx = makeCtx({ hasUI: false });
    refreshExtensionConfig(runtime, ctx);
    expect(mockSyncPermissionSystemStatus).not.toHaveBeenCalled();
  });
});

// ── saveExtensionConfig ────────────────────────────────────────────────────

describe("saveExtensionConfig", () => {
  it("writes merged config to the global config path and updates state", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-save-"));
    const runtime = makeRuntime();
    const ctx = makeCtx();
    runtime.agentDir = baseDir;

    const next = {
      debugLog: true,
      permissionReviewLog: true,
      yoloMode: true,
    };

    const fsOps = {
      mkdirSync,
      writeFileSync,
      renameSync: vi.fn((from: string, to: string) => {
        const content = readFileSync(from, "utf8");
        writeFileSync(to, content, "utf8");
      }),
      existsSync: vi.fn(() => true),
      unlinkSync: vi.fn(),
    };

    saveExtensionConfig(runtime, next, ctx as never, fsOps);

    const configPath = getGlobalConfigPath(baseDir);
    const persisted = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(persisted).toEqual(normalizePermissionSystemConfig(next));
    expect(runtime.config).toEqual(normalizePermissionSystemConfig(next));
    expect(mockSyncPermissionSystemStatus).toHaveBeenCalledWith(ctx, expect.any(Object));

    rmSync(baseDir, { recursive: true, force: true });
  });

  it("notifies the UI if writing the config fails", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-save-fail-"));
    const runtime = makeRuntime();
    const notify = vi.fn();
    const ctx = makeCtx({ ui: { notify, setStatus: vi.fn() } as never });
    runtime.agentDir = baseDir;

    const fsOps = {
      mkdirSync,
      writeFileSync,
      renameSync: vi.fn(() => {
        throw new Error("rename failed");
      }),
      existsSync: vi.fn().mockReturnValue(true),
      unlinkSync: vi.fn(),
    };

    saveExtensionConfig(
      runtime,
      { debugLog: true, permissionReviewLog: false, yoloMode: false },
      ctx as never,
      fsOps,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to save permission-system config"),
      "error",
    );
    expect(fsOps.unlinkSync).toHaveBeenCalled();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("does not delete a missing temporary file and ignores cleanup failures", () => {
    const runtime = makeRuntime();
    const notify = vi.fn();
    const ctx = makeCtx({ ui: { notify, setStatus: vi.fn() } as never });

    saveExtensionConfig(
      runtime,
      { debugLog: true, permissionReviewLog: false, yoloMode: false },
      ctx as never,
      {
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(() => {
          throw "write failed";
        }),
        renameSync: vi.fn(),
        existsSync: vi.fn().mockReturnValue(false),
        unlinkSync: vi.fn(() => {
          throw new Error("cleanup failed");
        }),
      },
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("write failed"), "error");

    saveExtensionConfig(
      runtime,
      { debugLog: true, permissionReviewLog: false, yoloMode: false },
      ctx as never,
      {
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(() => {
          throw new Error("write failed again");
        }),
        renameSync: vi.fn(),
        existsSync: vi.fn(() => {
          throw new Error("exists failed");
        }),
        unlinkSync: vi.fn(),
      },
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("write failed again"), "error");
  });
});

// ── logResolvedConfigPaths ─────────────────────────────────────────────────

describe("logResolvedConfigPaths", () => {
  it("logs the resolved policy path summary", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-runtime-paths-"));
    const agentDir = join(baseDir, "agent");
    const cwd = join(baseDir, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const legacyGlobalPolicyPath = getLegacyGlobalPolicyPath(agentDir);
    const legacyProjectPolicyPath = getLegacyProjectPolicyPath(cwd);
    mkdirSync(dirname(legacyGlobalPolicyPath), { recursive: true });
    mkdirSync(dirname(legacyProjectPolicyPath), { recursive: true });
    writeFileSync(legacyGlobalPolicyPath, "{}", "utf8");
    writeFileSync(legacyProjectPolicyPath, "{}", "utf8");

    const runtime = makeRuntime();
    runtime.agentDir = agentDir;
    const ctx = makeCtx({ cwd, hasUI: true });
    runtime.runtimeContext = ctx;
    runtime.permissionManager = {
      getResolvedPolicyPaths: () => ({
        globalConfigPath: "/global/config.json",
        projectGlobalConfigPath: "/project/config.json",
        agentConfigPath: "/agent/config.json",
        projectAgentConfigPath: "/project-agent/config.json",
      }),
    } as never;

    mockBuildResolvedConfigLogEntry.mockReturnValue({ resolved: true });

    logResolvedConfigPaths(runtime);

    expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyGlobalPolicyDetected: true,
        legacyProjectPolicyDetected: true,
        legacyExtensionConfigDetected: expect.any(Boolean),
      }),
    );
    expect(mockLoggerReview).toHaveBeenCalledWith("config.resolved", expect.any(Object));
    expect(mockLoggerDebug).toHaveBeenCalledWith("config.resolved", expect.any(Object));
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("logs resolved policy paths when runtimeContext has no cwd", () => {
    const runtime = makeRuntime();
    runtime.runtimeContext = null;
    runtime.permissionManager = {
      getResolvedPolicyPaths: () => ({
        globalConfigPath: "/global/config.json",
        projectGlobalConfigPath: null,
        agentConfigPath: null,
        projectAgentConfigPath: null,
      }),
    } as never;
    mockBuildResolvedConfigLogEntry.mockReturnValue({ resolved: true });

    logResolvedConfigPaths(runtime);

    expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyProjectPolicyDetected: false,
      }),
    );
  });
});

// resolveAgentName was moved to PermissionSession (#129)
// Tests live in tests/permission-session.test.ts
