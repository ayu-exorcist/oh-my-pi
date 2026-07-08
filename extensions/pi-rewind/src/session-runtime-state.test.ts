import { describe, expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";
import { RewindSessionRuntimeState, TreeRestoreCoordinator } from "./session-runtime-state";
import type { TreeEntryRecord } from "./utils/tree-entry";

function checkpoint(overrides: Partial<CheckpointEntry> = {}): CheckpointEntry {
  return {
    v: 2,
    kind: "checkpoint",
    turnId: "turn-1",
    userEntryId: "user-1",
    beforeCommit: "before-1",
    afterCommit: "after-1",
    prompt: "prompt",
    fileCount: 1,
    fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    createdAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function checkpointEntry(entry: CheckpointEntry): unknown {
  return { type: "custom", customType: "pi-checkpoint", data: entry };
}

function userEntry(id: string, parentId?: string): TreeEntryRecord {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "prompt" }] },
  };
}

describe("TreeRestoreCoordinator", () => {
  test("tracks pending tree restore intent and notifier state", () => {
    const coordinator = new TreeRestoreCoordinator();
    const sessionId = "session-1";
    const storedUi = { notify() {} } as unknown as ExtensionContext["ui"];
    const currentUi = { notify() {} } as unknown as ExtensionContext["ui"];
    const fallbackUi = { notify() {} } as unknown as ExtensionContext["ui"];

    expect(coordinator.consumeSuppressedTree(sessionId)).toBe(false);
    coordinator.suppress(sessionId);
    expect(coordinator.isSuppressed(sessionId)).toBe(true);
    expect(coordinator.consumeSuppressedTree(sessionId)).toBe(true);
    expect(coordinator.isSuppressed(sessionId)).toBe(false);

    coordinator.setConversationPending(sessionId, "target-1");
    expect(coordinator.consumePending(sessionId)).toEqual({
      targetId: "target-1",
      mode: "Restore conversation",
    });
    expect(coordinator.consumePending(sessionId)).toBeUndefined();

    coordinator.setCodePending(
      sessionId,
      {
        targetId: "target-2",
        mode: "Restore code and conversation",
        targetCommit: "after-2",
      },
      storedUi,
    );
    expect(coordinator.consumeNotifier(sessionId, currentUi, fallbackUi)).toBe(currentUi);
    expect(coordinator.consumeNotifier(sessionId, undefined, fallbackUi)).toBe(fallbackUi);

    coordinator.setCodePending(
      sessionId,
      {
        targetId: "target-3",
        mode: "Restore code and conversation",
        targetCommit: "after-3",
      },
      storedUi,
    );
    expect(coordinator.consumeNotifier(sessionId, undefined, fallbackUi)).toBe(storedUi);
    coordinator.clearPending(sessionId);
    expect(coordinator.consumePending(sessionId)).toBeUndefined();

    coordinator.suppress(sessionId);
    coordinator.setConversationPending(sessionId, "target-4");
    coordinator.reset(sessionId);
    expect(coordinator.isSuppressed(sessionId)).toBe(false);
    expect(coordinator.consumePending(sessionId)).toBeUndefined();
    expect(coordinator.consumeNotifier(sessionId, undefined, fallbackUi)).toBe(fallbackUi);
  });

  test("clears suppression explicitly", () => {
    const coordinator = new TreeRestoreCoordinator();
    coordinator.suppress("session-1");
    coordinator.clearSuppression("session-1");
    expect(coordinator.isSuppressed("session-1")).toBe(false);
  });
});

describe("RewindSessionRuntimeState", () => {
  test("returns default config and default tree restore mode", () => {
    const runtime = new RewindSessionRuntimeState();

    expect(runtime.getSessionConfig("session-1").enabled).toBe(true);
    expect(runtime.getSessionTreeRestoreMode("session-1")).toBe("ask");
  });

  test("resets per-session state and initializes synced commit when requested", () => {
    const runtime = new RewindSessionRuntimeState();
    const entry = checkpoint();
    const entries = [userEntry("user-1"), checkpointEntry(entry)];

    runtime.lastCheckpointTurnIds.set("session-1", "old-turn");
    runtime.treeRestores.suppress("session-1");
    runtime.sessionSyncedCodeCommits.set("session-1", "old-commit");

    runtime.resetSession("session-1", entries, [userEntry("user-1")], true);

    expect(runtime.lastCheckpointTurnIds.getOrUndefined("session-1")).toBeUndefined();
    expect(runtime.treeRestores.isSuppressed("session-1")).toBe(false);
    expect(runtime.sessionHasCheckpointFileChanges.getOrUndefined("session-1")).toBe(true);
    expect(runtime.sessionCheckpointEntries.getOrUndefined("session-1")).toEqual([entry]);
    expect(runtime.sessionSyncedCodeCommits.getOrUndefined("session-1")).toBe("after-1");

    runtime.resetSession("session-1", entries, [userEntry("uncheckpointed")], true);
    expect(runtime.sessionSyncedCodeCommits.getOrUndefined("session-1")).toBeUndefined();
  });

  test("reset leaves synced commit empty when initialization is disabled", () => {
    const runtime = new RewindSessionRuntimeState();
    const entry = checkpoint({ fileCount: 0, fileChanges: [] });
    const entries = [userEntry("user-1"), checkpointEntry(entry)];

    runtime.sessionSyncedCodeCommits.set("session-1", "old-commit");
    runtime.resetSession("session-1", entries, [userEntry("user-1")], false);

    expect(runtime.sessionHasCheckpointFileChanges.getOrUndefined("session-1")).toBe(false);
    expect(runtime.sessionSyncedCodeCommits.getOrUndefined("session-1")).toBeUndefined();
  });

  test("starts tree navigation unless tree restore is suppressed", () => {
    const runtime = new RewindSessionRuntimeState();

    expect(runtime.startTreeNavigation("session-1", "target-1")).toBe(true);
    expect(runtime.treeRestores.consumePending("session-1")).toEqual({
      targetId: "target-1",
      mode: "Restore conversation",
    });

    runtime.treeRestores.suppress("session-1");
    expect(runtime.startTreeNavigation("session-1", "target-2")).toBe(false);
  });

  test("plans always-mode tree code restore with stored session ui", async () => {
    const runtime = new RewindSessionRuntimeState();
    const sessionUi = { notify() {} } as unknown as ExtensionContext["ui"];
    const entry = checkpoint();
    const entries = [userEntry("user-1"), checkpointEntry(entry)];

    runtime.sessionTreeRestoreModes.set("session-1", "always");
    runtime.sessionSyncedCodeCommits.set("session-1", "after-1");
    runtime.sessionNotifiers.set("session-1", sessionUi);

    await runtime.planTreeCodeRestore({
      sessionId: "session-1",
      targetId: "user-1",
      entries,
      hasUI: false,
      ui: undefined,
    });

    expect(runtime.treeRestores.consumePending("session-1")).toEqual({
      targetId: "user-1",
      mode: "Restore code and conversation",
      targetCommit: "before-1",
    });
    expect(runtime.treeRestores.consumeNotifier("session-1", undefined, undefined)).toBe(sessionUi);
  });

  test("plans ask-mode tree code restore only when the user agrees", async () => {
    const runtime = new RewindSessionRuntimeState();
    const ui = { select: vi.fn().mockResolvedValue("Yes") } as unknown as ExtensionContext["ui"];
    const entry = checkpoint();
    const entries = [userEntry("user-1"), checkpointEntry(entry)];

    runtime.sessionSyncedCodeCommits.set("session-1", "after-1");
    await runtime.planTreeCodeRestore({
      sessionId: "session-1",
      targetId: "user-1",
      entries,
      hasUI: true,
      ui,
    });

    expect(ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(runtime.treeRestores.consumePending("session-1")).toEqual({
      targetId: "user-1",
      mode: "Restore code and conversation",
      targetCommit: "before-1",
    });

    const declineUi = {
      select: vi.fn().mockResolvedValue("No"),
    } as unknown as ExtensionContext["ui"];
    await runtime.planTreeCodeRestore({
      sessionId: "session-2",
      targetId: "user-1",
      entries,
      hasUI: true,
      ui: declineUi,
    });
    expect(runtime.treeRestores.consumePending("session-2")).toBeUndefined();
  });

  test("clears pending tree restore in never mode", async () => {
    const runtime = new RewindSessionRuntimeState();
    const entries = [userEntry("user-1"), checkpointEntry(checkpoint())];

    runtime.sessionTreeRestoreModes.set("session-1", "never");
    runtime.treeRestores.setConversationPending("session-1", "user-1");

    await runtime.planTreeCodeRestore({
      sessionId: "session-1",
      targetId: "user-1",
      entries,
      hasUI: false,
      ui: undefined,
    });

    expect(runtime.treeRestores.consumePending("session-1")).toBeUndefined();
  });
});
