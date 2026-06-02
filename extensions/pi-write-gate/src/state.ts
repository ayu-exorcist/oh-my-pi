import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isPermissionMode, permissionModeFromBoolean, type PermissionMode } from "./mode";
import type { WriteGateState, WriteStatusContext } from "./ui";
import { setPermissionMode } from "./ui";

export const WRITE_GATE_STATE_ENTRY = "pi-write-gate.state";

export type PersistSource = "command" | "shortcut" | "auto_fallback" | "session_restore";

export interface PersistedWriteGateState {
  readonly mode: PermissionMode;
  readonly source: PersistSource;
  readonly timestamp: string;
}

function isValidSource(value: unknown): value is PersistSource {
  return (
    value === "command" ||
    value === "shortcut" ||
    value === "auto_fallback" ||
    value === "session_restore"
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractModeFromLegacy(value: Record<string, unknown>): PermissionMode | undefined {
  // Legacy format: { writeEnabled: boolean, source: "command" | "shortcut", timestamp: string }
  if (typeof value.writeEnabled === "boolean") {
    const legacySource = value.source;
    if (legacySource === "command" || legacySource === "shortcut") {
      return permissionModeFromBoolean(value.writeEnabled);
    }
  }
  return undefined;
}

export function isPersistedWriteGateState(value: unknown): value is PersistedWriteGateState {
  if (!isRecord(value)) return false;
  if (typeof value.timestamp !== "string") return false;

  // Current format
  if (isPermissionMode(value.mode) && isValidSource(value.source)) {
    return true;
  }

  // Legacy boolean format (read-only compatibility)
  return extractModeFromLegacy(value) !== undefined;
}

export function getPermissionModeFromState(value: unknown): PermissionMode | undefined {
  if (!isRecord(value)) return undefined;

  if (isPermissionMode(value.mode) && isValidSource(value.source)) {
    return value.mode;
  }

  return extractModeFromLegacy(value);
}

export function getLatestPersistedPermissionMode(
  entries: readonly SessionEntry[],
): PermissionMode | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== WRITE_GATE_STATE_ENTRY) continue;
    const mode = getPermissionModeFromState(entry.data);
    if (mode !== undefined) return mode;
  }

  return undefined;
}

export function shouldRestoreWriteMode(reason: string): boolean {
  return reason === "startup" || reason === "reload" || reason === "resume";
}

export function restorePermissionModeForSessionStart(
  reason: string,
  ctx: ExtensionContext,
): PermissionMode {
  if (!shouldRestoreWriteMode(reason)) return "off";
  return getLatestPersistedPermissionMode(ctx.sessionManager.getEntries()) ?? "off";
}

export function persistWriteMode(
  pi: ExtensionAPI,
  mode: PermissionMode,
  source: PersistSource,
): void {
  pi.appendEntry(WRITE_GATE_STATE_ENTRY, {
    mode,
    source,
    timestamp: new Date().toISOString(),
  } satisfies PersistedWriteGateState);
}

export function setAndPersistWriteMode(
  pi: ExtensionAPI,
  state: WriteGateState,
  mode: PermissionMode,
  ctx: WriteStatusContext,
  source: PersistSource,
): void {
  setPermissionMode(state, mode, ctx);
  persistWriteMode(pi, mode, source);
}

export function toggleAndPersistWriteMode(
  pi: ExtensionAPI,
  state: WriteGateState,
  ctx: WriteStatusContext,
  source: PersistSource,
): void {
  const nextMode: PermissionMode = state.mode === "off" ? "on" : "off";
  setAndPersistWriteMode(pi, state, nextMode, ctx, source);
}

// Backward-compatible aliases (boolean API kept for external consumers)
export function getLatestPersistedWriteEnabled(
  entries: readonly SessionEntry[],
): boolean | undefined {
  const mode = getLatestPersistedPermissionMode(entries);
  return mode === undefined ? undefined : mode === "on";
}

export function restoreWriteModeForSessionStart(reason: string, ctx: ExtensionContext): boolean {
  return restorePermissionModeForSessionStart(reason, ctx) === "on";
}
