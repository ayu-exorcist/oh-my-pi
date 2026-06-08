import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => [] as string[]),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => fsMock);

import type { ForwardedPermissionLogger } from "#src/forwarded-permissions/io";
import {
  ensureDirectoryExists,
  ensurePermissionForwardingLocation,
  safeDeleteFile,
  tryRemoveDirectoryIfEmpty,
  writeJsonFileAtomic,
} from "#src/forwarded-permissions/io";

function makeLogger(): ForwardedPermissionLogger {
  return {
    writeReviewLog: vi.fn(),
    writeDebugLog: vi.fn(),
  };
}

function errno(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe("forwarded permission IO filesystem failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(true);
    fsMock.mkdirSync.mockImplementation(() => undefined);
    fsMock.readdirSync.mockReturnValue([]);
    fsMock.rmdirSync.mockImplementation(() => undefined);
    fsMock.unlinkSync.mockImplementation(() => undefined);
    fsMock.writeFileSync.mockImplementation(() => undefined);
    fsMock.renameSync.mockImplementation(() => undefined);
  });

  it("logs and returns false when directory creation fails", () => {
    const logger = makeLogger();
    fsMock.mkdirSync.mockImplementationOnce(() => {
      throw new Error("mkdir failed");
    });

    expect(ensureDirectoryExists(logger, "/tmp/target", "target")).toBe(false);
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.error",
      expect.objectContaining({
        message: expect.stringContaining("Failed to create target directory"),
        error: "mkdir failed",
      }),
    );
  });

  it("returns null when any forwarding location directory cannot be created", () => {
    const logger = makeLogger();
    fsMock.mkdirSync
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("requests failed");
      })
      .mockImplementationOnce(() => undefined);

    expect(ensurePermissionForwardingLocation(logger, "/forwarding", "session-1")).toBeNull();
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.error",
      expect.objectContaining({
        message: expect.stringContaining("permission forwarding requests"),
      }),
    );
  });

  it("logs a warning when empty-directory inspection fails", () => {
    const logger = makeLogger();
    fsMock.readdirSync.mockImplementationOnce(() => {
      throw new Error("readdir failed");
    });

    tryRemoveDirectoryIfEmpty(logger, "/tmp/empty", "empty");

    expect(fsMock.rmdirSync).not.toHaveBeenCalled();
    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({
        message: expect.stringContaining("Failed to inspect empty directory"),
        error: "readdir failed",
      }),
    );
  });

  it("does not remove non-empty directories", () => {
    fsMock.readdirSync.mockReturnValueOnce(["request.json"]);

    tryRemoveDirectoryIfEmpty(makeLogger(), "/tmp/non-empty", "non-empty");

    expect(fsMock.rmdirSync).not.toHaveBeenCalled();
  });

  it("ignores races when empty-directory removal sees ENOENT or ENOTEMPTY", () => {
    fsMock.rmdirSync.mockImplementationOnce(() => {
      throw errno("ENOENT");
    });
    tryRemoveDirectoryIfEmpty(makeLogger(), "/tmp/missing", "missing");

    fsMock.rmdirSync.mockImplementationOnce(() => {
      throw errno("ENOTEMPTY");
    });
    tryRemoveDirectoryIfEmpty(makeLogger(), "/tmp/raced", "raced");

    expect(fsMock.rmdirSync).toHaveBeenCalledTimes(2);
  });

  it("logs unexpected empty-directory removal errors", () => {
    const logger = makeLogger();
    fsMock.rmdirSync.mockImplementationOnce(() => {
      throw new Error("remove failed");
    });

    tryRemoveDirectoryIfEmpty(logger, "/tmp/bad", "bad");

    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({
        message: expect.stringContaining("Failed to remove empty bad directory"),
        error: "remove failed",
      }),
    );
  });

  it("logs unexpected delete-file errors", () => {
    const logger = makeLogger();
    fsMock.unlinkSync.mockImplementationOnce(() => {
      throw new Error("unlink failed");
    });

    safeDeleteFile(logger, "/tmp/file.json", "request");

    expect(logger.writeReviewLog).toHaveBeenCalledWith(
      "permission_forwarding.warning",
      expect.objectContaining({
        message: expect.stringContaining("Failed to delete request file"),
        error: "unlink failed",
      }),
    );
  });

  it("deletes the temporary file and rethrows when atomic write rename fails", () => {
    fsMock.renameSync.mockImplementationOnce(() => {
      throw new Error("rename failed");
    });

    expect(() => writeJsonFileAtomic(makeLogger(), "/tmp/final.json", { ok: true })).toThrow(
      "rename failed",
    );
    expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining("/tmp/final.json."));
  });
});
