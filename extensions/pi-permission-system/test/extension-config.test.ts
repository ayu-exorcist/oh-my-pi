import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectMisplacedPermissionKeys,
  ensurePermissionSystemLogsDirectory,
  normalizePermissionSystemConfig,
} from "#src/extension-config";

describe("detectMisplacedPermissionKeys", () => {
  it("returns an empty array for a record with only valid extension keys", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      permissionReviewLog: true,
      yoloMode: false,
    });
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty record", () => {
    const result = detectMisplacedPermissionKeys({});
    expect(result).toEqual([]);
  });

  it("returns misplaced key names when legacy permission-rule keys are present", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      defaultPolicy: { tools: "ask" },
      bash: { "git status": "allow" },
    });
    expect(result).toEqual(["defaultPolicy", "bash"]);
  });

  it("detects all known legacy permission-rule keys", () => {
    const result = detectMisplacedPermissionKeys({
      defaultPolicy: {},
      tools: {},
      bash: {},
      mcp: {},
      skills: {},
      special: {},
      external_directory: {},
    });
    expect(result).toEqual([
      "defaultPolicy",
      "tools",
      "bash",
      "mcp",
      "skills",
      "special",
      "external_directory",
    ]);
  });

  it("does not detect doom_loop as a misplaced permission key", () => {
    const result = detectMisplacedPermissionKeys({
      doom_loop: {},
    });
    expect(result).toEqual([]);
  });

  it("does not flag the new flat-format permission key as misplaced", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: false,
      permission: { "*": "ask" },
    });
    expect(result).toEqual([]);
  });

  it("ignores unknown keys that are not permission-rule keys", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      someRandomKey: "value",
    });
    expect(result).toEqual([]);
  });
});

describe("normalizePermissionSystemConfig", () => {
  it("normalizes a valid config object", () => {
    const result = normalizePermissionSystemConfig({
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: true,
    });
    expect(result).toEqual({
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: true,
    });
  });

  it("defaults debugLog to false when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.debugLog).toBe(false);
  });

  it("defaults permissionReviewLog to true when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.permissionReviewLog).toBe(true);
  });

  it("defaults yoloMode to false when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.yoloMode).toBe(false);
  });

  it("coerces non-boolean values to their defaults", () => {
    const result = normalizePermissionSystemConfig({
      debugLog: "yes",
      permissionReviewLog: 1,
      yoloMode: null,
    });
    expect(result.debugLog).toBe(false);
    expect(result.permissionReviewLog).toBe(true);
    expect(result.yoloMode).toBe(false);
  });

  it("preserves string pi infrastructure read paths", () => {
    const result = normalizePermissionSystemConfig({
      piInfrastructureReadPaths: ["/tmp/pi", "~/agent"],
    });
    expect(result.piInfrastructureReadPaths).toEqual(["/tmp/pi", "~/agent"]);
  });

  it("drops non-string pi infrastructure read paths", () => {
    const result = normalizePermissionSystemConfig({
      piInfrastructureReadPaths: ["/tmp/pi", 123],
    });
    expect(result.piInfrastructureReadPaths).toBeUndefined();
  });

  it("handles null/undefined input gracefully", () => {
    const result = normalizePermissionSystemConfig(null);
    expect(result).toEqual({
      debugLog: false,
      permissionReviewLog: true,
      yoloMode: false,
    });
  });
});

describe("ensurePermissionSystemLogsDirectory", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "permission-system-logs-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates log directories recursively", () => {
    expect(ensurePermissionSystemLogsDirectory(join(root, "nested", "logs"))).toBeUndefined();
  });

  it("returns a warning when log directory creation fails", () => {
    const filePath = join(root, "not-a-dir");
    writeFileSync(filePath, "file", "utf8");
    expect(ensurePermissionSystemLogsDirectory(filePath)).toContain(
      "Failed to create permission-system log directory",
    );
  });
});
