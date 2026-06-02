import { describe, expect, test, vi } from "vitest";
import {
  getLatestPersistedPermissionMode,
  getLatestPersistedWriteEnabled,
  getPermissionModeFromState,
  isPersistedWriteGateState,
  isRecord,
  persistWriteMode,
  restorePermissionModeForSessionStart,
  restoreWriteModeForSessionStart,
  setAndPersistWriteMode,
  shouldRestoreWriteMode,
  toggleAndPersistWriteMode,
  WRITE_GATE_STATE_ENTRY,
} from "./state";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { WriteGateState } from "./ui";

let nextId = 0;

function customEntry(data: unknown): SessionEntry {
  nextId++;
  return {
    type: "custom",
    id: `entry-${nextId}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: WRITE_GATE_STATE_ENTRY,
    data,
  };
}

function contextWithEntries(entries: readonly SessionEntry[]): ExtensionContext {
  return {
    sessionManager: {
      getEntries: () => entries,
    },
  } as unknown as ExtensionContext;
}

describe("write gate persisted state", () => {
  test("isRecord validates object shape", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true); // arrays are typeof 'object'
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
  });

  test("validates persisted state shape", () => {
    // v1 backward compatibility
    expect(
      isPersistedWriteGateState({
        writeEnabled: true,
        source: "command",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(isPersistedWriteGateState({ writeEnabled: true, source: "bad", timestamp: "now" })).toBe(
      false,
    );

    // v2 current format
    expect(
      isPersistedWriteGateState({
        version: 2,
        mode: "on",
        source: "command",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isPersistedWriteGateState({
        version: 2,
        mode: "off",
        source: "auto_fallback",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isPersistedWriteGateState({
        version: 2,
        mode: "unknown",
        source: "command",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);

    // Edge cases
    expect(isPersistedWriteGateState(null)).toBe(false);
    expect(isPersistedWriteGateState("string")).toBe(false);
    expect(isPersistedWriteGateState({ mode: "on", source: "command" })).toBe(false);
  });

  test("getPermissionModeFromState handles invalid inputs", () => {
    expect(getPermissionModeFromState(null)).toBeUndefined();
    expect(getPermissionModeFromState("string")).toBeUndefined();
    expect(getPermissionModeFromState({ mode: "on", source: "command" })).toBe("on");
    expect(getPermissionModeFromState({ writeEnabled: true, source: "command" })).toBe("on");
  });

  test("reads latest persisted write mode", () => {
    const entries = [
      customEntry({ writeEnabled: false, source: "command", timestamp: "1" }),
      customEntry({ writeEnabled: true, source: "shortcut", timestamp: "2" }),
    ];

    expect(getLatestPersistedPermissionMode(entries)).toBe("on");
    expect(getLatestPersistedPermissionMode([])).toBeUndefined();
  });

  test("reads latest persisted permission mode from v2 format", () => {
    const entries = [
      customEntry({ version: 2, mode: "off", source: "command", timestamp: "1" }),
      customEntry({ version: 2, mode: "on", source: "shortcut", timestamp: "2" }),
    ];

    expect(getLatestPersistedPermissionMode(entries)).toBe("on");
  });

  test("restores only startup, reload, and resume sessions", () => {
    expect(shouldRestoreWriteMode("startup")).toBe(true);
    expect(shouldRestoreWriteMode("reload")).toBe(true);
    expect(shouldRestoreWriteMode("resume")).toBe(true);
    expect(shouldRestoreWriteMode("new")).toBe(false);
    expect(shouldRestoreWriteMode("fork")).toBe(false);

    const ctx = contextWithEntries([
      customEntry({ writeEnabled: true, source: "command", timestamp: "1" }),
    ]);
    expect(restorePermissionModeForSessionStart("startup", ctx)).toBe("on");
    expect(restorePermissionModeForSessionStart("new", ctx)).toBe("off");
  });

  test("restores default off when no persisted state found", () => {
    const ctx = contextWithEntries([]);
    expect(restorePermissionModeForSessionStart("startup", ctx)).toBe("off");
  });

  test("handles sparse entries array", () => {
    const entries: (SessionEntry | undefined)[] = [undefined, undefined, undefined];
    entries[1] = customEntry({ writeEnabled: true, source: "command", timestamp: "1" });
    expect(getLatestPersistedPermissionMode(entries as SessionEntry[])).toBe("on");
  });

  test("ignores entries with wrong customType", () => {
    const entries = [
      {
        type: "custom",
        id: "1",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "other",
        data: { writeEnabled: true },
      } as SessionEntry,
      customEntry({ writeEnabled: false, source: "shortcut", timestamp: "2" }),
    ];
    expect(getLatestPersistedPermissionMode(entries)).toBe("off");
  });

  test("ignores entries with invalid data", () => {
    const entries = [
      customEntry({ invalid: true }),
      customEntry({ writeEnabled: true, source: "command", timestamp: "1" }),
    ];
    expect(getLatestPersistedPermissionMode(entries)).toBe("on");
  });

  test("persists write mode changes", () => {
    const appendEntry = vi.fn();
    const api = { appendEntry } as unknown as ExtensionAPI;

    persistWriteMode(api, "on", "command");
    expect(appendEntry).toHaveBeenCalledWith(
      WRITE_GATE_STATE_ENTRY,
      expect.objectContaining({ mode: "on", source: "command" }),
    );
  });

  test("sets and toggles state while persisting", () => {
    const appendEntry = vi.fn();
    const api = { appendEntry } as unknown as ExtensionAPI;
    const state: WriteGateState = { mode: "off", activeTui: undefined };
    const setStatus = vi.fn();

    setAndPersistWriteMode(api, state, "on", { ui: { setStatus } }, "command");
    expect(state.mode).toBe("on");
    expect(appendEntry).toHaveBeenLastCalledWith(
      WRITE_GATE_STATE_ENTRY,
      expect.objectContaining({ mode: "on", source: "command" }),
    );

    toggleAndPersistWriteMode(api, state, { ui: { setStatus } }, "shortcut");
    expect(state.mode).toBe("off");
    expect(appendEntry).toHaveBeenLastCalledWith(
      WRITE_GATE_STATE_ENTRY,
      expect.objectContaining({ mode: "off", source: "shortcut" }),
    );
  });

  test("getLatestPersistedWriteEnabled converts mode to boolean", () => {
    expect(
      getLatestPersistedWriteEnabled([
        customEntry({ mode: "on", source: "command", timestamp: "1" }),
      ]),
    ).toBe(true);
    expect(
      getLatestPersistedWriteEnabled([
        customEntry({ mode: "off", source: "command", timestamp: "1" }),
      ]),
    ).toBe(false);
    expect(getLatestPersistedWriteEnabled([])).toBeUndefined();
  });

  test("restoreWriteModeForSessionStart returns boolean", () => {
    const ctx = contextWithEntries([
      customEntry({ mode: "on", source: "command", timestamp: "1" }),
    ]);
    expect(restoreWriteModeForSessionStart("startup", ctx)).toBe(true);
    expect(restoreWriteModeForSessionStart("new", ctx)).toBe(false);
  });
});
