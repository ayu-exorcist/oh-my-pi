import { describe, test, expect, vi, type Mock } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import { registerRewind, buildCheckpointItem } from "./rewind";

function createMockCtx(checkpointEntries: CheckpointEntry[] = []): {
  ui: { notify: Mock; select: Mock; input: Mock };
  navigateTree: Mock;
  sessionManager: { getEntries: () => unknown[]; getSessionId: () => string };
} {
  return {
    ui: {
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
    },
    navigateTree: vi.fn(),
    sessionManager: {
      getEntries: () =>
        checkpointEntries.map((data) => ({
          type: "custom",
          customType: "pi-checkpoint",
          data,
        })),
      getSessionId: () => "test-session",
    },
  };
}

function createMockPi(): ExtensionAPI {
  return { registerCommand: vi.fn() } as unknown as ExtensionAPI;
}

function getRegisterCall(pi: ExtensionAPI) {
  return (pi.registerCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].handler;
}

function createEntry(
  partial: Partial<CheckpointEntry> & { userEntryId: string; beforeCommit: string },
): CheckpointEntry {
  return {
    v: 2,
    kind: "checkpoint",
    turnId: "turn-1",
    afterCommit: partial.beforeCommit,
    prompt: "test",
    fileCount: 0,
    fileChanges: [],
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("registerRewind", () => {
  test("registers /rewind command", () => {
    const pi = createMockPi();
    registerRewind(pi, () => undefined);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "rewind",
      expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }),
    );
  });

  test("warns when repo is not ready", async () => {
    const pi = createMockPi();
    registerRewind(pi, () => undefined);
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx();
    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Checkpoint extension not ready", "warning");
  });

  test("warns when no checkpoints available", async () => {
    const pi = createMockPi();
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx([]);
    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No checkpoints available", "warning");
  });

  test("returns early when user cancels checkpoint selection", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select.mockResolvedValueOnce(undefined);
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
  });

  test("returns early when selected item not found in list", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select.mockResolvedValueOnce("some random string not in items");
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
  });

  test("returns early when user cancels mode selection", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce(undefined);
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(2);
    expect(ctx.navigateTree).not.toHaveBeenCalled();
  });

  test("returns early when user selects Never mind", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Never mind");
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(2);
    expect(ctx.navigateTree).not.toHaveBeenCalled();
  });

  test("conversation restore fails gracefully", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const navigateTree = vi.fn().mockRejectedValue(new Error("nav error"));
    const entries = [
      createEntry({
        userEntryId: "e1",
        beforeCommit: "abc",
        afterCommit: "def",
        fileCount: 1,
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = { ...createMockCtx(entries), navigateTree };
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code and conversation");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Conversation restore failed: nav error", "error");
  });

  test("conversation restore handles non-Error failure", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const navigateTree = vi.fn().mockRejectedValue("string error");
    const entries = [
      createEntry({
        userEntryId: "e1",
        beforeCommit: "abc",
        afterCommit: "def",
        fileCount: 1,
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = { ...createMockCtx(entries), navigateTree };
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code and conversation");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Conversation restore failed: string error",
      "error",
    );
  });

  test("restore code and conversation", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({
        userEntryId: "e1",
        beforeCommit: "abc",
        afterCommit: "def",
        fileCount: 1,
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code and conversation");
    await handler("", ctx);
    expect(stageAll).toHaveBeenCalled();
    expect(diffAgainst).toHaveBeenCalledWith("def");
    expect(createSafetyCommit).toHaveBeenCalled();
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(ctx.navigateTree).toHaveBeenCalledWith("e1", { summarize: false });
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("restore conversation only bypasses dirty guard", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("1\t0\tfile.ts\n");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () => createMockRepo({ checkoutCommit, stageAll, diffAgainst }));
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore conversation only");
    await handler("", ctx);
    expect(stageAll).not.toHaveBeenCalled();
    expect(checkoutCommit).not.toHaveBeenCalled();
    expect(ctx.navigateTree).toHaveBeenCalledWith("e1", { summarize: false });
  });

  test("restore code only", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(ctx.navigateTree).not.toHaveBeenCalled();
  });

  test("summarize from here handles error", async () => {
    const pi = createMockPi();
    const navigateTree = vi.fn().mockRejectedValue(new Error("nav error"));
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = { ...createMockCtx(entries), navigateTree };
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Summarize from here");
    ctx.ui.input.mockResolvedValueOnce("");
    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind failed: nav error", "error");
  });

  test("summarize from here handles non-Error failure", async () => {
    const pi = createMockPi();
    const navigateTree = vi.fn().mockRejectedValue("string error");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo({ checkoutCommit: vi.fn() }));
    const handler = getRegisterCall(pi);
    const ctx = { ...createMockCtx(entries), navigateTree };
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Summarize from here");
    ctx.ui.input.mockResolvedValueOnce("");
    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind failed: string error", "error");
  });

  test("summarize from here with custom input", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo({ checkoutCommit }));
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Summarize from here");
    ctx.ui.input.mockResolvedValueOnce("focus on API");
    await handler("", ctx);
    expect(ctx.navigateTree).toHaveBeenCalledWith("e1", {
      summarize: true,
      customInstructions: "focus on API",
    });
    expect(checkoutCommit).not.toHaveBeenCalled();
  });

  test("summarize from here with empty input uses undefined", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo({ checkoutCommit: vi.fn() }));
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Summarize from here");
    ctx.ui.input.mockResolvedValueOnce("");
    await handler("", ctx);
    expect(ctx.navigateTree).toHaveBeenCalledWith("e1", {
      summarize: true,
      customInstructions: undefined,
    });
  });

  test("dirty guard blocks rewind when workspace has changes", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("1\t0\tfile.ts\n");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () => createMockRepo({ checkoutCommit, stageAll, diffAgainst }));
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(stageAll).toHaveBeenCalled();
    expect(diffAgainst).toHaveBeenCalledWith("def");
    expect(checkoutCommit).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.",
      "warning",
    );
  });

  test("dirty guard skips when diff fails", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn().mockRejectedValue(new Error("stage fail"));
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () => createMockRepo({ checkoutCommit, stageAll, createSafetyCommit }));
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
  });

  test("rollback safety restores on failure", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn().mockRejectedValueOnce(new Error("git error"));
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(checkoutCommit).toHaveBeenCalledWith("safety");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind failed: git error", "error");
  });

  test("rollback safety handles rollback failure", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi
      .fn()
      .mockRejectedValueOnce(new Error("git error"))
      .mockRejectedValueOnce(new Error("rollback error"));
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(checkoutCommit).toHaveBeenCalledWith("safety");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Rewind failed and rollback also failed: rollback error",
      "error",
    );
  });

  test("rollback safety handles non-Error rollback failure", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi
      .fn()
      .mockRejectedValueOnce(new Error("git error"))
      .mockRejectedValueOnce("string rollback");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(checkoutCommit).toHaveBeenCalledWith("safety");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Rewind failed and rollback also failed: string rollback",
      "error",
    );
  });

  test("restore without safety commit when createSafetyCommit fails", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn().mockRejectedValue(new Error("git error"));
    const createSafetyCommit = vi.fn().mockRejectedValue(new Error("safety fail"));
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(createSafetyCommit).toHaveBeenCalled();
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind failed: git error", "error");
  });

  test("handles non-Error restore failure", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi
      .fn()
      .mockRejectedValueOnce("string error")
      .mockResolvedValueOnce(undefined);
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def" })];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind failed: string error", "error");
  });

  test("renders removed changes correctly", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({
        userEntryId: "e1",
        beforeCommit: "abc",
        afterCommit: "def",
        fileCount: 1,
        fileChanges: [{ path: "a.ts", added: 0, removed: 3 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
  });

  test("renders multiple files when diffStats returned empty", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def", fileCount: 2 }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
  });

  test("renders single file when diffStats returned empty", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({ userEntryId: "e1", beforeCommit: "abc", afterCommit: "def", fileCount: 1 }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(entries[0]))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
  });
});
