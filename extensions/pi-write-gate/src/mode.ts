export type PermissionMode = "off" | "on" | "auto";

const ALL_MODES: readonly PermissionMode[] = ["off", "on", "auto"];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && ALL_MODES.includes(value as PermissionMode);
}

export function permissionModeFromBoolean(enabled: boolean): PermissionMode {
  return enabled ? "on" : "off";
}

export function nextCycleMode(current: PermissionMode): PermissionMode {
  switch (current) {
    case "off":
      return "on";
    case "on":
      return "auto";
    case "auto":
      return "off";
  }
}
