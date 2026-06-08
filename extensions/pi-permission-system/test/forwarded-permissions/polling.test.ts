import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetActiveAgentName,
  mockGetActiveAgentNameFromSystemPrompt,
  mockIsSubagentExecutionContext,
  mockResolveTargetSessionId,
  mockEnsurePermissionForwardingLocation,
  mockGetExistingPermissionForwardingLocation,
  mockListRequestFiles,
  mockReadForwardedPermissionRequest,
  mockReadForwardedPermissionResponse,
  mockWriteJsonFileAtomic,
  mockSafeDeleteFile,
  mockCleanupPermissionForwardingLocationIfEmpty,
  mockLogPermissionForwardingError,
  mockLogPermissionForwardingWarning,
  mockSleep,
  mockGetContextSystemPrompt,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockGetActiveAgentName: vi.fn(),
  mockGetActiveAgentNameFromSystemPrompt: vi.fn(),
  mockIsSubagentExecutionContext: vi.fn(),
  mockResolveTargetSessionId: vi.fn(),
  mockEnsurePermissionForwardingLocation: vi.fn(),
  mockGetExistingPermissionForwardingLocation: vi.fn(),
  mockListRequestFiles: vi.fn(),
  mockReadForwardedPermissionRequest: vi.fn(),
  mockReadForwardedPermissionResponse: vi.fn(),
  mockWriteJsonFileAtomic: vi.fn(),
  mockSafeDeleteFile: vi.fn(),
  mockCleanupPermissionForwardingLocationIfEmpty: vi.fn(),
  mockLogPermissionForwardingError: vi.fn(),
  mockLogPermissionForwardingWarning: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
  mockGetContextSystemPrompt: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: mockExistsSync,
}));

vi.mock("../../src/active-agent", () => ({
  getActiveAgentName: mockGetActiveAgentName,
  getActiveAgentNameFromSystemPrompt: mockGetActiveAgentNameFromSystemPrompt,
}));

vi.mock("../../src/subagent-context", () => ({
  isSubagentExecutionContext: mockIsSubagentExecutionContext,
}));

vi.mock("../../src/permission-forwarding", () => ({
  PERMISSION_FORWARDING_POLL_INTERVAL_MS: 10,
  PERMISSION_FORWARDING_TIMEOUT_MS: 50,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES: ["PI_SUBAGENT_PARENT_SESSION"],
  resolvePermissionForwardingTargetSessionId: mockResolveTargetSessionId,
  isForwardedPermissionRequestForSession: vi.fn(
    (request: { targetSessionId: string }, sessionId: string) =>
      request.targetSessionId === sessionId,
  ),
}));

vi.mock("../../src/forwarded-permissions/io", () => ({
  ensurePermissionForwardingLocation: mockEnsurePermissionForwardingLocation,
  getExistingPermissionForwardingLocation: mockGetExistingPermissionForwardingLocation,
  listRequestFiles: mockListRequestFiles,
  readForwardedPermissionRequest: mockReadForwardedPermissionRequest,
  readForwardedPermissionResponse: mockReadForwardedPermissionResponse,
  writeJsonFileAtomic: mockWriteJsonFileAtomic,
  safeDeleteFile: mockSafeDeleteFile,
  cleanupPermissionForwardingLocationIfEmpty: mockCleanupPermissionForwardingLocationIfEmpty,
  logPermissionForwardingError: mockLogPermissionForwardingError,
  logPermissionForwardingWarning: mockLogPermissionForwardingWarning,
  sleep: mockSleep,
}));

vi.mock("../../src/common", () => ({
  toRecord: (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {},
}));

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  confirmPermission,
  formatForwardedPermissionPrompt,
  getSessionId,
  processForwardedPermissionRequests,
  waitForForwardedPermissionApproval,
} from "#src/forwarded-permissions/polling";

function makeLogger() {
  return {
    writeReviewLog: vi.fn(),
    writeDebugLog: vi.fn(),
  };
}

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    hasUI: false,
    ui: {
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
      setStatus: vi.fn(),
    },
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue("sess-1"),
      getSessionDir: vi.fn().mockReturnValue("/sessions/sess-1"),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    forwardingDir: "/forwarding",
    subagentSessionsDir: "/subagents",
    registry: undefined,
    logger: makeLogger(),
    writeReviewLog: vi.fn(),
    requestPermissionDecisionFromUi: vi.fn(),
    shouldAutoApprove: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveTargetSessionId.mockReset();
  mockEnsurePermissionForwardingLocation.mockReset();
  mockGetExistingPermissionForwardingLocation.mockReset();
  mockListRequestFiles.mockReset();
  mockReadForwardedPermissionRequest.mockReset();
  mockReadForwardedPermissionResponse.mockReset();
  mockWriteJsonFileAtomic.mockReset();
  mockSafeDeleteFile.mockReset();
  mockCleanupPermissionForwardingLocationIfEmpty.mockReset();
  mockLogPermissionForwardingError.mockReset();
  mockLogPermissionForwardingWarning.mockReset();
  mockSleep.mockReset().mockResolvedValue(undefined);
  mockGetActiveAgentName.mockReset();
  mockGetActiveAgentNameFromSystemPrompt.mockReset();
  mockIsSubagentExecutionContext.mockReset();
  mockGetContextSystemPrompt.mockReset();
  mockExistsSync.mockReset().mockReturnValue(false);
  mockIsSubagentExecutionContext.mockReturnValue(false);
  mockResolveTargetSessionId.mockReturnValue("parent-sess");
  mockEnsurePermissionForwardingLocation.mockReturnValue({
    label: "primary",
    sessionRootDir: "/forwarding/parent-sess",
    requestsDir: "/forwarding/parent-sess/requests",
    responsesDir: "/forwarding/parent-sess/responses",
  });
  mockGetExistingPermissionForwardingLocation.mockReturnValue({
    label: "primary",
    sessionRootDir: "/forwarding/sess-1",
    requestsDir: "/forwarding/sess-1/requests",
    responsesDir: "/forwarding/sess-1/responses",
  });
  mockListRequestFiles.mockReturnValue([]);
  mockReadForwardedPermissionRequest.mockReturnValue({
    id: "req-1",
    createdAt: 1,
    requesterSessionId: "sess-child",
    targetSessionId: "sess-1",
    requesterAgentName: "agent",
    message: "Allow?",
  });
  mockReadForwardedPermissionResponse.mockReturnValue({
    approved: true,
    state: "approved",
    responderSessionId: "sess-1",
    respondedAt: 2,
  });
});

describe("forwarded-permissions/polling", () => {
  it("getSessionId trims valid IDs and falls back on blank IDs and errors", () => {
    expect(
      getSessionId(makeCtx({ sessionManager: { getSessionId: () => "  abc  " } } as never)),
    ).toBe("abc");
    expect(getSessionId(makeCtx({ sessionManager: { getSessionId: () => "   " } } as never))).toBe(
      "unknown",
    );
    expect(
      getSessionId(
        makeCtx({
          sessionManager: {
            getSessionId: () => {
              throw new Error("boom");
            },
          },
        } as never),
      ),
    ).toBe("unknown");
  });

  it("formatForwardedPermissionPrompt renders request metadata", () => {
    expect(
      formatForwardedPermissionPrompt({
        id: "req-1",
        createdAt: 1,
        requesterSessionId: "sess-1",
        targetSessionId: "sess-2",
        requesterAgentName: "agent",
        message: "Allow?",
      }),
    ).toContain("Subagent 'agent' requested permission.");
  });

  it("confirmPermission returns immediate UI approval when hasUI is true", async () => {
    const ctx = makeCtx({ hasUI: true });
    const deps = makeDeps({
      requestPermissionDecisionFromUi: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    await expect(confirmPermission(ctx, "Allow?", deps)).resolves.toEqual({
      approved: true,
      state: "approved",
    });
  });

  it("confirmPermission denies when non-subagent and no UI", async () => {
    const ctx = makeCtx({ hasUI: false });
    mockIsSubagentExecutionContext.mockReturnValue(false);
    const deps = makeDeps();
    await expect(confirmPermission(ctx, "Allow?", deps)).resolves.toEqual({
      approved: false,
      state: "denied",
    });
  });

  it("confirmPermission forwards subagent requests when no UI is available", async () => {
    const ctx = makeCtx({ hasUI: false });
    mockIsSubagentExecutionContext.mockReturnValue(true);
    mockWriteJsonFileAtomic.mockImplementationOnce(() => {
      mockExistsSync.mockReturnValue(true);
    });

    await expect(confirmPermission(ctx, "Allow?", makeDeps())).resolves.toEqual(
      expect.objectContaining({ approved: true, state: "approved" }),
    );
  });

  it("waitForForwardedPermissionApproval denies when target session cannot be resolved", async () => {
    const ctx = makeCtx();
    mockResolveTargetSessionId.mockReturnValue(null);
    const result = await waitForForwardedPermissionApproval(ctx, "Allow?", makeDeps());
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("waitForForwardedPermissionApproval denies when forwarding location cannot be created", async () => {
    const ctx = makeCtx();
    mockEnsurePermissionForwardingLocation.mockReturnValue(null);
    const result = await waitForForwardedPermissionApproval(ctx, "Allow?", makeDeps());
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("waitForForwardedPermissionApproval writes request and waits for response", async () => {
    const ctx = makeCtx({ getSystemPrompt: () => "agent coder" } as never);
    mockGetActiveAgentName.mockReturnValue(null);
    mockGetActiveAgentNameFromSystemPrompt.mockReturnValue("coder");
    mockWriteJsonFileAtomic.mockImplementationOnce(() => {
      mockExistsSync.mockReturnValue(true);
    });

    const result = await waitForForwardedPermissionApproval(ctx, "Allow?", makeDeps());
    expect(result).toEqual({
      approved: true,
      state: "approved",
      responderSessionId: "sess-1",
      respondedAt: 2,
    } as never);
    expect(mockReadForwardedPermissionResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("responses"),
    );
    expect(mockGetActiveAgentNameFromSystemPrompt).toHaveBeenCalledWith("agent coder");
  });

  it("waitForForwardedPermissionApproval tolerates missing and throwing system prompt accessors", async () => {
    mockGetActiveAgentName.mockReturnValue(null);
    mockGetActiveAgentNameFromSystemPrompt.mockReturnValue(null);
    mockWriteJsonFileAtomic.mockImplementation(() => {
      mockExistsSync.mockReturnValue(true);
    });

    await expect(
      waitForForwardedPermissionApproval(
        makeCtx({ getSystemPrompt: "not a function" } as never),
        "Allow?",
        makeDeps(),
      ),
    ).resolves.toEqual(expect.objectContaining({ approved: true }));

    mockExistsSync.mockReturnValue(false);
    await expect(
      waitForForwardedPermissionApproval(
        makeCtx({
          getSystemPrompt: () => {
            throw new Error("prompt read failed");
          },
        } as never),
        "Allow?",
        makeDeps(),
      ),
    ).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(mockLogPermissionForwardingWarning).toHaveBeenCalledWith(
      null,
      "Failed to read context system prompt for forwarded permission metadata",
      expect.any(Error),
    );
  });

  it("waitForForwardedPermissionApproval denies when writing the request fails", async () => {
    const ctx = makeCtx();
    mockWriteJsonFileAtomic.mockImplementationOnce(() => {
      throw new Error("write failed");
    });

    const result = await waitForForwardedPermissionApproval(ctx, "Allow?", makeDeps());
    expect(result).toEqual({ approved: false, state: "denied" });
    expect(mockLogPermissionForwardingError).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Failed to write forwarded permission request"),
      expect.any(Error),
    );
  });

  it("waitForForwardedPermissionApproval denies and cleans up when no response arrives", async () => {
    const ctx = makeCtx();
    mockExistsSync.mockReturnValue(false);

    const result = await waitForForwardedPermissionApproval(ctx, "Allow?", makeDeps());
    expect(result).toEqual({ approved: false, state: "denied" });
    expect(mockLogPermissionForwardingWarning).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Timed out waiting for forwarded permission response"),
    );
    expect(mockSafeDeleteFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("requests"),
      "forwarded permission request",
    );
    expect(mockCleanupPermissionForwardingLocationIfEmpty).toHaveBeenCalled();
  });

  it("processForwardedPermissionRequests returns early without UI, location, or request files", async () => {
    const headlessCtx = makeCtx({ hasUI: false });
    await processForwardedPermissionRequests(headlessCtx, makeDeps());
    expect(mockGetExistingPermissionForwardingLocation).not.toHaveBeenCalled();

    const uiCtx = makeCtx({ hasUI: true });
    mockGetExistingPermissionForwardingLocation.mockReturnValueOnce(null);
    await processForwardedPermissionRequests(uiCtx, makeDeps());
    expect(mockListRequestFiles).not.toHaveBeenCalled();

    mockGetExistingPermissionForwardingLocation.mockReturnValueOnce({
      label: "primary",
      sessionRootDir: "/forwarding/sess-1",
      requestsDir: "/forwarding/sess-1/requests",
      responsesDir: "/forwarding/sess-1/responses",
    });
    mockListRequestFiles.mockReturnValueOnce([]);
    await processForwardedPermissionRequests(uiCtx, makeDeps());
    expect(mockReadForwardedPermissionRequest).not.toHaveBeenCalled();
  });

  it("processForwardedPermissionRequests handles invalid requests and wrong session targets", async () => {
    const ctx = makeCtx({ hasUI: true });
    mockListRequestFiles.mockReturnValue(["bad.json", "wrong.json"]);
    mockReadForwardedPermissionRequest.mockReturnValueOnce(null).mockReturnValueOnce({
      id: "req-wrong",
      createdAt: 1,
      requesterSessionId: "sess-child",
      targetSessionId: "other",
      requesterAgentName: "agent",
      message: "Allow?",
    });
    await processForwardedPermissionRequests(ctx, makeDeps());
    expect(mockSafeDeleteFile).toHaveBeenCalled();
  });

  it("processForwardedPermissionRequests auto-approves and writes response", async () => {
    const ctx = makeCtx({ hasUI: true });
    mockListRequestFiles.mockReturnValue(["req.json"]);
    mockReadForwardedPermissionRequest.mockReturnValue({
      id: "req-1",
      createdAt: 1,
      requesterSessionId: "sess-child",
      targetSessionId: "sess-1",
      requesterAgentName: "agent",
      message: "Allow?",
    });
    const deps = makeDeps({ shouldAutoApprove: vi.fn().mockReturnValue(true) });
    await processForwardedPermissionRequests(ctx, deps);
    expect(mockWriteJsonFileAtomic).toHaveBeenCalled();
  });

  it("processForwardedPermissionRequests denies when the UI prompt fails", async () => {
    const ctx = makeCtx({ hasUI: true });
    mockListRequestFiles.mockReturnValue(["req.json"]);
    const deps = makeDeps({
      requestPermissionDecisionFromUi: vi.fn().mockRejectedValue(new Error("prompt failed")),
    });

    await processForwardedPermissionRequests(ctx, deps);

    expect(mockLogPermissionForwardingError).toHaveBeenCalledWith(
      expect.anything(),
      "Failed to show forwarded permission confirmation dialog",
      expect.any(Error),
    );
    expect(mockWriteJsonFileAtomic).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("responses"),
      expect.objectContaining({ approved: false, state: "denied" }),
    );
  });

  it("processForwardedPermissionRequests logs and keeps processing when response write fails", async () => {
    const ctx = makeCtx({ hasUI: true });
    mockListRequestFiles.mockReturnValue(["req.json"]);
    mockWriteJsonFileAtomic.mockImplementationOnce(() => {
      throw new Error("response failed");
    });

    await processForwardedPermissionRequests(
      ctx,
      makeDeps({
        requestPermissionDecisionFromUi: vi
          .fn()
          .mockResolvedValue({ approved: true, state: "approved" }),
      }),
    );

    expect(mockLogPermissionForwardingError).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Failed to write primary forwarded permission response"),
      expect.any(Error),
    );
    expect(mockSafeDeleteFile).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("requests"),
      "primary forwarded permission request",
    );
    expect(mockCleanupPermissionForwardingLocationIfEmpty).toHaveBeenCalled();
  });
});
