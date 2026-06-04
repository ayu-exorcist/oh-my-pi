import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForwardingManager } from "#src/forwarding-manager";

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockProcessForwardedPermissionRequests = vi.hoisted(() => vi.fn());
const mockIsSubagentExecutionContext = vi.hoisted(() => vi.fn());

vi.mock("../src/forwarded-permissions/polling", () => ({
  processForwardedPermissionRequests: mockProcessForwardedPermissionRequests,
}));

vi.mock("../src/subagent-context", () => ({
  isSubagentExecutionContext: mockIsSubagentExecutionContext,
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function makeCtx(overrides: { hasUI?: boolean; sessionId?: string } = {}) {
  return {
    hasUI: overrides.hasUI ?? true,
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue(overrides.sessionId ?? "sess-1"),
    },
    cwd: "/project",
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
}

function makeForwardingDeps() {
  return {
    forwardingDir: "/agent/sessions/permission-forwarding",
    subagentSessionsDir: "/agent/subagent-sessions",
    logger: { writeReviewLog: vi.fn(), writeDebugLog: vi.fn() },
    writeReviewLog: vi.fn(),
    requestPermissionDecisionFromUi: vi.fn(),
    shouldAutoApprove: vi.fn().mockReturnValue(false),
  } as unknown as import("../src/forwarded-permissions/polling").PermissionForwardingDeps;
}

function makeManager() {
  return new ForwardingManager("/agent/subagent-sessions", makeForwardingDeps());
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ForwardingManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsSubagentExecutionContext.mockReset();
    mockIsSubagentExecutionContext.mockReturnValue(false);
    mockProcessForwardedPermissionRequests.mockReset();
    mockProcessForwardedPermissionRequests.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("stop()", () => {
    it("is a no-op when not started", () => {
      const manager = makeManager();
      expect(() => manager.stop()).not.toThrow();
    });

    it("clears the timer and processing state after start()", async () => {
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);
      manager.stop();

      // After stop, the timer fires no more callbacks.
      mockProcessForwardedPermissionRequests.mockClear();
      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessForwardedPermissionRequests).not.toHaveBeenCalled();
    });
  });

  describe("start()", () => {
    it("does not start polling when hasUI is false", async () => {
      const manager = makeManager();
      const ctx = makeCtx({ hasUI: false });
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessForwardedPermissionRequests).not.toHaveBeenCalled();
    });

    it("stops any existing poll and does not start a new one when hasUI is false", async () => {
      const manager = makeManager();
      const uiCtx = makeCtx({ hasUI: true });
      const noUiCtx = makeCtx({ hasUI: false });

      manager.start(uiCtx);
      // Now stop the polling by calling start() with no-UI ctx.
      manager.start(noUiCtx);

      mockProcessForwardedPermissionRequests.mockClear();
      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessForwardedPermissionRequests).not.toHaveBeenCalled();
    });

    it("does not start polling when isSubagentExecutionContext returns true", async () => {
      mockIsSubagentExecutionContext.mockReturnValue(true);
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessForwardedPermissionRequests).not.toHaveBeenCalled();
    });

    it("stops any existing poll when called with a subagent context", async () => {
      mockIsSubagentExecutionContext.mockReturnValueOnce(false);
      const manager = makeManager();
      const ctx1 = makeCtx();
      manager.start(ctx1);

      // Second call with a subagent context.
      mockIsSubagentExecutionContext.mockReturnValue(true);
      const ctx2 = makeCtx();
      manager.start(ctx2);

      mockProcessForwardedPermissionRequests.mockClear();
      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessForwardedPermissionRequests).not.toHaveBeenCalled();
    });

    it("starts polling and calls processForwardedPermissionRequests on tick", async () => {
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessForwardedPermissionRequests).toHaveBeenCalledWith(ctx, expect.anything());
    });

    it("is idempotent — calling start() twice does not create a second timer", async () => {
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(250);
      // Only one tick should fire per interval, not two.
      expect(mockProcessForwardedPermissionRequests).toHaveBeenCalledTimes(1);
    });

    it("updates the context when called again while already running", async () => {
      const manager = makeManager();
      const ctx1 = makeCtx({ sessionId: "sess-1" });
      const ctx2 = makeCtx({ sessionId: "sess-2" });
      manager.start(ctx1);
      manager.start(ctx2);

      await vi.advanceTimersByTimeAsync(250);
      // The process call should use the newer context.
      expect(mockProcessForwardedPermissionRequests).toHaveBeenCalledWith(ctx2, expect.anything());
    });

    it("skips a tick while processing is in progress", async () => {
      // Make processForwardedPermissionRequests hang so processing=true persists.
      let resolveProcess: () => void;
      mockProcessForwardedPermissionRequests.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveProcess = resolve;
        }),
      );

      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);

      // First tick starts processing.
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessForwardedPermissionRequests).toHaveBeenCalledTimes(1);

      // Second tick is skipped because processing flag is still true.
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessForwardedPermissionRequests).toHaveBeenCalledTimes(1);

      // Resolve and a third tick should fire.
      resolveProcess!();
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessForwardedPermissionRequests).toHaveBeenCalledTimes(2);
    });

    it("passes subagentSessionsDir from the constructor to isSubagentExecutionContext", () => {
      const manager = new ForwardingManager("/custom/subagent-dir", makeForwardingDeps());
      const ctx = makeCtx();
      manager.start(ctx);

      expect(mockIsSubagentExecutionContext).toHaveBeenCalledWith(
        ctx,
        "/custom/subagent-dir",
        undefined,
      );
    });
  });
});
