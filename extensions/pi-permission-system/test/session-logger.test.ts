import { describe, expect, it, vi } from "vitest";
import type { ExtensionRuntime } from "#src/runtime";
import { createSessionLogger } from "#src/session-logger";

// ── helpers ────────────────────────────────────────────────────────────────

function makeRuntime(overrides: Partial<ExtensionRuntime> = {}): ExtensionRuntime {
  return {
    runtimeContext: null,
    writeDebugLog: vi.fn(),
    writeReviewLog: vi.fn(),
    ...overrides,
  } as unknown as ExtensionRuntime;
}

// ── createSessionLogger ────────────────────────────────────────────────────

describe("createSessionLogger", () => {
  describe("debug", () => {
    it("delegates to runtime.writeDebugLog with event and details", () => {
      const runtime = makeRuntime();
      const logger = createSessionLogger(runtime);

      logger.debug("test.event", { key: "value" });

      expect(runtime.writeDebugLog).toHaveBeenCalledWith("test.event", {
        key: "value",
      });
    });

    it("delegates to runtime.writeDebugLog with event and no details", () => {
      const runtime = makeRuntime();
      const logger = createSessionLogger(runtime);

      logger.debug("test.event");

      expect(runtime.writeDebugLog).toHaveBeenCalledWith("test.event", undefined);
    });
  });

  describe("review", () => {
    it("delegates to runtime.writeReviewLog with event and details", () => {
      const runtime = makeRuntime();
      const logger = createSessionLogger(runtime);

      logger.review("permission.granted", { agentName: "coder" });

      expect(runtime.writeReviewLog).toHaveBeenCalledWith("permission.granted", {
        agentName: "coder",
      });
    });

    it("delegates to runtime.writeReviewLog with event and no details", () => {
      const runtime = makeRuntime();
      const logger = createSessionLogger(runtime);

      logger.review("permission.granted");

      expect(runtime.writeReviewLog).toHaveBeenCalledWith("permission.granted", undefined);
    });
  });

  describe("warn", () => {
    it("calls ui.notify with the message and 'warning' severity when runtimeContext is present", () => {
      const notify = vi.fn();
      const runtime = makeRuntime({
        runtimeContext: {
          ui: { notify, setStatus: vi.fn(), select: vi.fn(), input: vi.fn() },
        } as unknown as ExtensionRuntime["runtimeContext"],
      });
      const logger = createSessionLogger(runtime);

      logger.warn("Something went wrong");

      expect(notify).toHaveBeenCalledWith("Something went wrong", "warning");
    });

    it("does not throw when runtimeContext is null", () => {
      const runtime = makeRuntime({ runtimeContext: null });
      const logger = createSessionLogger(runtime);

      expect(() => logger.warn("no-op warning")).not.toThrow();
    });

    it("reads runtimeContext at call time, not at creation time", () => {
      const runtime = makeRuntime({ runtimeContext: null });
      const logger = createSessionLogger(runtime);

      // runtimeContext is null at creation — warn should be a no-op now
      logger.warn("early warning");

      // Later runtimeContext is set
      const notify = vi.fn();
      runtime.runtimeContext = {
        ui: { notify, setStatus: vi.fn(), select: vi.fn(), input: vi.fn() },
      } as unknown as ExtensionRuntime["runtimeContext"];

      logger.warn("late warning");

      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith("late warning", "warning");
    });
  });
});
