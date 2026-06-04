import { describe, expect, it, vi } from "vitest";

import type { ForwardedPermissionLogger } from "#src/forwarded-permissions/io";
import {
  formatUnknownErrorMessage,
  isErrnoCode,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
} from "#src/forwarded-permissions/io";

// ── helpers ────────────────────────────────────────────────────────────────

function makeLogger(): ForwardedPermissionLogger {
  return {
    writeReviewLog: vi.fn(),
    writeDebugLog: vi.fn(),
  };
}

// ── formatUnknownErrorMessage ──────────────────────────────────────────────

describe("formatUnknownErrorMessage", () => {
  it("returns the error message for Error instances", () => {
    expect(formatUnknownErrorMessage(new Error("oops"))).toBe("oops");
  });

  it("converts non-Error values to string", () => {
    expect(formatUnknownErrorMessage("raw string")).toBe("raw string");
    expect(formatUnknownErrorMessage(42)).toBe("42");
  });

  it("falls back to String(error) for Error with empty message", () => {
    // error.message is falsy (""), so the function falls through to String(error)
    const e = new Error("");
    expect(formatUnknownErrorMessage(e)).toBe("Error");
  });
});

// ── isErrnoCode ────────────────────────────────────────────────────────────

describe("isErrnoCode", () => {
  it("returns true when code matches", () => {
    expect(isErrnoCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
  });

  it("returns false when code does not match", () => {
    expect(isErrnoCode({ code: "EACCES" }, "ENOENT")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isErrnoCode(null, "ENOENT")).toBe(false);
  });

  it("returns false when no code property", () => {
    expect(isErrnoCode({}, "ENOENT")).toBe(false);
  });
});

// ── logPermissionForwardingWarning ─────────────────────────────────────────

describe("logPermissionForwardingWarning", () => {
  it("calls logger.writeReviewLog with the warning event", () => {
    const logger = makeLogger();
    logPermissionForwardingWarning(logger, "something went wrong");
    expect(logger.writeReviewLog).toHaveBeenCalledWith("permission_forwarding.warning", {
      message: "something went wrong",
    });
  });

  it("calls logger.writeDebugLog with the warning event", () => {
    const logger = makeLogger();
    logPermissionForwardingWarning(logger, "something went wrong");
    expect(logger.writeDebugLog).toHaveBeenCalledWith("permission_forwarding.warning", {
      message: "something went wrong",
    });
  });

  it("includes formatted error when an error is provided", () => {
    const logger = makeLogger();
    logPermissionForwardingWarning(logger, "bad thing", new Error("fs fail"));
    expect(logger.writeReviewLog).toHaveBeenCalledWith("permission_forwarding.warning", {
      message: "bad thing",
      error: "fs fail",
    });
  });

  it("does not throw when logger is null", () => {
    expect(() => logPermissionForwardingWarning(null, "ignored")).not.toThrow();
  });

  it("does not call anything when logger is null", () => {
    // Verify the null-logger path is a true no-op — cannot easily spy on null,
    // but we can verify the call succeeds silently.
    expect(() => logPermissionForwardingWarning(null, "msg", new Error("err"))).not.toThrow();
  });
});

// ── logPermissionForwardingError ───────────────────────────────────────────

describe("logPermissionForwardingError", () => {
  it("calls logger.writeReviewLog with the error event", () => {
    const logger = makeLogger();
    logPermissionForwardingError(logger, "critical failure");
    expect(logger.writeReviewLog).toHaveBeenCalledWith("permission_forwarding.error", {
      message: "critical failure",
    });
  });

  it("calls logger.writeDebugLog with the error event", () => {
    const logger = makeLogger();
    logPermissionForwardingError(logger, "critical failure");
    expect(logger.writeDebugLog).toHaveBeenCalledWith("permission_forwarding.error", {
      message: "critical failure",
    });
  });

  it("includes formatted error when an error is provided", () => {
    const logger = makeLogger();
    logPermissionForwardingError(logger, "io error", new Error("ENOENT"));
    expect(logger.writeReviewLog).toHaveBeenCalledWith("permission_forwarding.error", {
      message: "io error",
      error: "ENOENT",
    });
  });

  it("does not throw when logger is null", () => {
    expect(() => logPermissionForwardingError(null, "ignored")).not.toThrow();
  });
});
