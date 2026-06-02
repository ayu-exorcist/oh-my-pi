import { describe, expect, test } from "vitest";
import { isPermissionMode, nextCycleMode, permissionModeFromBoolean } from "./mode";

describe("mode", () => {
  test("isPermissionMode validates mode strings", () => {
    expect(isPermissionMode("off")).toBe(true);
    expect(isPermissionMode("on")).toBe(true);
    expect(isPermissionMode("auto")).toBe(true);
    expect(isPermissionMode("unknown")).toBe(false);
    expect(isPermissionMode(123)).toBe(false);
    expect(isPermissionMode(null)).toBe(false);
    expect(isPermissionMode(undefined)).toBe(false);
  });

  test("permissionModeFromBoolean converts boolean to mode", () => {
    expect(permissionModeFromBoolean(true)).toBe("on");
    expect(permissionModeFromBoolean(false)).toBe("off");
  });

  test("nextCycleMode cycles through modes", () => {
    expect(nextCycleMode("off")).toBe("on");
    expect(nextCycleMode("on")).toBe("auto");
    expect(nextCycleMode("auto")).toBe("off");
  });
});
