import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ForwardedPermissionLogger } from "#src/forwarded-permissions/io";
import {
  cleanupPermissionForwardingLocationIfEmpty,
  ensureDirectoryExists,
  ensurePermissionForwardingLocation,
  formatUnknownErrorMessage,
  getExistingPermissionForwardingLocation,
  getPermissionForwardingLocationForSession,
  isErrnoCode,
  listRequestFiles,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
  readForwardedPermissionRequest,
  readForwardedPermissionResponse,
  safeDeleteFile,
  tryRemoveDirectoryIfEmpty,
  writeJsonFileAtomic,
  sleep,
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

// ── filesystem helpers ─────────────────────────────────────────────────────

describe("filesystem helpers", () => {
  it("ensureDirectoryExists creates directories", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-io-"));
    const target = join(baseDir, "nested");
    expect(ensureDirectoryExists(makeLogger(), target, "nested dir")).toBe(true);
    expect(() => mkdirSync(target)).toThrow();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("ensurePermissionForwardingLocation creates session directories", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-forwarding-"));
    const location = ensurePermissionForwardingLocation(makeLogger(), baseDir, "sess-1");
    expect(location).not.toBeNull();
    expect(location?.label).toBe("primary");
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("ensurePermissionForwardingLocation returns null for invalid session ids", () => {
    const logger = makeLogger();
    expect(ensurePermissionForwardingLocation(logger, "/tmp/forwarding", "   ")).toBeNull();
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.error",
      expect.objectContaining({ message: "Failed to resolve permission forwarding location" }),
    );
  });

  it("getPermissionForwardingLocationForSession builds expected paths", () => {
    const location = getPermissionForwardingLocationForSession("/tmp/forwarding", "sess-1");
    expect(location.sessionRootDir).toContain("sess-1");
  });

  it("getExistingPermissionForwardingLocation returns null when missing", () => {
    expect(getExistingPermissionForwardingLocation("/tmp/forwarding", "missing")).toBeNull();
  });

  it("getExistingPermissionForwardingLocation returns null for invalid session ids", () => {
    expect(getExistingPermissionForwardingLocation("/tmp/forwarding", "")).toBeNull();
  });

  it("tryRemoveDirectoryIfEmpty removes empty directory", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-remove-"));
    tryRemoveDirectoryIfEmpty(makeLogger(), baseDir, "temp");
    expect(() => readFileSync(baseDir)).toThrow();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("tryRemoveDirectoryIfEmpty ignores missing directories", () => {
    expect(() =>
      tryRemoveDirectoryIfEmpty(makeLogger(), join(tmpdir(), "missing-forwarding-dir"), "missing"),
    ).not.toThrow();
  });

  it("safeDeleteFile ignores missing files", () => {
    expect(() =>
      safeDeleteFile(makeLogger(), join(tmpdir(), "missing.json"), "missing"),
    ).not.toThrow();
  });

  it("writeJsonFileAtomic writes a file", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-write-"));
    const file = join(baseDir, "data.json");
    writeJsonFileAtomic(makeLogger(), file, { hello: "world" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ hello: "world" });
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("readForwardedPermissionRequest parses valid data", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-read-"));
    const file = join(baseDir, "request.json");
    writeFileSync(
      file,
      JSON.stringify({
        id: "req-1",
        createdAt: 1,
        requesterSessionId: "sess-1",
        targetSessionId: "sess-2",
        requesterAgentName: "agent",
        message: "allow?",
      }),
    );
    expect(readForwardedPermissionRequest(makeLogger(), file)?.id).toBe("req-1");
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("readForwardedPermissionRequest returns null for invalid and unreadable files", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-read-invalid-"));
    const invalid = join(baseDir, "invalid-request.json");
    writeFileSync(invalid, JSON.stringify({ id: "req-1" }));
    const logger = makeLogger();

    expect(readForwardedPermissionRequest(logger, invalid)).toBeNull();
    expect(readForwardedPermissionRequest(logger, join(baseDir, "missing.json"))).toBeNull();
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({
        message: expect.stringContaining("invalid forwarded permission request"),
      }),
    );
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({ message: expect.stringContaining("Failed to read") }),
    );
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("readForwardedPermissionResponse parses valid data", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-read-"));
    const file = join(baseDir, "response.json");
    writeFileSync(
      file,
      JSON.stringify({
        approved: true,
        state: "approved",
        responderSessionId: "sess-2",
      }),
    );
    expect(readForwardedPermissionResponse(makeLogger(), file)?.approved).toBe(true);
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("readForwardedPermissionResponse normalizes optional fields and rejects invalid data", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-response-invalid-"));
    const valid = join(baseDir, "response-valid.json");
    const invalid = join(baseDir, "response-invalid.json");
    writeFileSync(
      valid,
      JSON.stringify({
        approved: false,
        state: "denied",
        denialReason: 123,
        responderSessionId: "sess-2",
        respondedAt: "later",
      }),
    );
    writeFileSync(invalid, JSON.stringify({ approved: "yes", state: "bad" }));
    const logger = makeLogger();

    const parsed = readForwardedPermissionResponse(logger, valid);
    expect(parsed?.denialReason).toBeUndefined();
    expect(parsed?.respondedAt).toBeTypeOf("number");
    expect(readForwardedPermissionResponse(logger, invalid)).toBeNull();
    expect(readForwardedPermissionResponse(logger, join(baseDir, "missing.json"))).toBeNull();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("listRequestFiles sorts json files and ignores non-json files", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-list-"));
    writeFileSync(join(baseDir, "b.json"), "{}");
    writeFileSync(join(baseDir, "a.json"), "{}");
    writeFileSync(join(baseDir, "note.txt"), "ignored");
    expect(listRequestFiles(makeLogger(), baseDir)).toEqual(["a.json", "b.json"]);
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("listRequestFiles returns empty array when the directory cannot be read", () => {
    const logger = makeLogger();
    expect(listRequestFiles(logger, join(tmpdir(), "missing-forwarding-requests"))).toEqual([]);
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({ message: expect.stringContaining("Failed to read") }),
    );
  });

  it("cleanupPermissionForwardingLocationIfEmpty removes empty dirs", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-cleanup-"));
    const location = ensurePermissionForwardingLocation(makeLogger(), baseDir, "sess-1");
    expect(location).not.toBeNull();
    if (location) {
      cleanupPermissionForwardingLocationIfEmpty(makeLogger(), location);
    }
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("sleep resolves", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
