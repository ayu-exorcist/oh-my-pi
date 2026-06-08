import { describe, expect, it, vi, afterEach } from "vitest";

const { mockAppendFileSync } = vi.hoisted(() => ({
  mockAppendFileSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    appendFileSync: mockAppendFileSync,
  };
});

import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import { createPermissionSystemLogger, safeJsonStringify } from "#src/logging";

afterEach(() => {
  vi.clearAllMocks();
});

describe("safeJsonStringify", () => {
  it("serializes Error objects with message and stack", () => {
    const result = safeJsonStringify(new Error("boom"));
    expect(result).toContain('"name":"Error"');
    expect(result).toContain('"message":"boom"');
  });

  it("serializes bigint values as strings", () => {
    expect(safeJsonStringify({ value: 123n })).toContain('"value":"123"');
  });

  it("serializes circular structures", () => {
    const input: Record<string, unknown> = { name: "loop" };
    input.self = input;
    expect(safeJsonStringify(input)).toContain("[Circular]");
  });
});

describe("createPermissionSystemLogger", () => {
  it("writes debug and review logs when enabled", () => {
    const logger = createPermissionSystemLogger({
      getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true, permissionReviewLog: true }),
      debugLogPath: "/tmp/debug.jsonl",
      reviewLogPath: "/tmp/review.jsonl",
      ensureLogsDirectory: () => undefined,
    });

    logger.debug("debug.event", { a: 1 });
    logger.review("review.event", { b: 2 });

    expect(mockAppendFileSync).toHaveBeenCalledTimes(2);
    expect(mockAppendFileSync).toHaveBeenNthCalledWith(
      1,
      "/tmp/debug.jsonl",
      expect.stringContaining("debug.event"),
      "utf-8",
    );
    expect(mockAppendFileSync).toHaveBeenNthCalledWith(
      2,
      "/tmp/review.jsonl",
      expect.stringContaining("review.event"),
      "utf-8",
    );
  });

  it("skips debug and review writes when disabled", () => {
    const logger = createPermissionSystemLogger({
      getConfig: () => ({
        ...DEFAULT_EXTENSION_CONFIG,
        debugLog: false,
        permissionReviewLog: false,
      }),
      debugLogPath: "/tmp/debug.jsonl",
      reviewLogPath: "/tmp/review.jsonl",
      ensureLogsDirectory: () => undefined,
    });

    expect(logger.debug("debug.event")).toBeUndefined();
    expect(logger.review("review.event")).toBeUndefined();
    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it("returns the directory error before writing", () => {
    const logger = createPermissionSystemLogger({
      getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true, permissionReviewLog: true }),
      debugLogPath: "/tmp/debug.jsonl",
      reviewLogPath: "/tmp/review.jsonl",
      ensureLogsDirectory: () => "no dir",
    });

    expect(logger.review("review.event")).toBe("no dir");
    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it("returns serialization and append errors", () => {
    const logger = createPermissionSystemLogger({
      getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true, permissionReviewLog: true }),
      debugLogPath: "/tmp/debug.jsonl",
      reviewLogPath: "/tmp/review.jsonl",
      ensureLogsDirectory: () => undefined,
    });

    expect(logger.debug("debug.event", { toJSON: () => undefined })).toContain(
      "event could not be serialized",
    );

    mockAppendFileSync.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(logger.review("review.event")).toBe(
      "Failed to write permission-system review log '/tmp/review.jsonl': disk full",
    );

    mockAppendFileSync.mockImplementationOnce(() => {
      throw "string failure";
    });
    expect(logger.debug("debug.event")).toBe(
      "Failed to write permission-system debug log '/tmp/debug.jsonl': string failure",
    );
  });
});
