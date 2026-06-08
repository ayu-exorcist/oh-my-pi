import { describe, expect, it, vi } from "vitest";

import {
  PERMISSION_SYSTEM_STATUS_KEY,
  PERMISSION_SYSTEM_YOLO_STATUS_VALUE,
  getPermissionSystemStatus,
  syncPermissionSystemStatus,
} from "#src/status";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";

describe("status", () => {
  it("returns yolo status when yolo mode is enabled", () => {
    expect(getPermissionSystemStatus({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true })).toBe(
      PERMISSION_SYSTEM_YOLO_STATUS_VALUE,
    );
  });

  it("returns undefined when yolo mode is disabled", () => {
    expect(
      getPermissionSystemStatus({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: false }),
    ).toBeUndefined();
  });

  it("syncPermissionSystemStatus forwards the computed status key and value", () => {
    const setStatus = vi.fn();
    syncPermissionSystemStatus(
      { ui: { setStatus } },
      { ...DEFAULT_EXTENSION_CONFIG, yoloMode: true },
    );

    expect(setStatus).toHaveBeenCalledWith(PERMISSION_SYSTEM_STATUS_KEY, "yolo");
  });
});
