import { describe, test, expect, vi, type Mock } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import {
  registerRewind,
  buildCheckpointItem,
  findConversationEntryIdForCheckpoint,
  formatChangeLine,
} from "./rewind";

function createMockCtx(
  checkpointEntries: CheckpointEntry[] = [],
  branchUserEntryIds: readonly string[] = checkpointEntries.map((cp) => cp.userEntryId),
): {
  ui: { notify: Mock; select: Mock; input: Mock };
  navigateTree: Mock;
  sessionManager: {
    getEntries: () => unknown[];
    getBranch: () => unknown[];
    getSessionId: () => string;
  };
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
      getBranch: () =>
        branchUserEntryIds.map((id) => ({
          type: "message",
          id,
          message: { role: "user" },
        })),
      getSessionId: () => "test-session",
    },
  };
}

function createMockPi(): ExtensionAPI {
  return { registerCommand: vi.fn() } as unknown as ExtensionAPI;
}

function getRegisterCall(pi: ExtensionAPI) {
  const call = (pi.registerCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  if (!call) throw new Error("expected registerCommand call");
  return call[1].handler;
}

function firstEntry(entries: readonly CheckpointEntry[]): CheckpointEntry {
  const entry = entries[0];
  if (!entry) throw new Error("expected checkpoint entry");
  return entry;
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

describe("buildCheckpointItem", () => {
  test("renders no code changes line", () => {
    const cp = createEntry({
      userEntryId: "entry-1",
      beforeCommit: "before",
      prompt: "ask question",
      createdAt: "2026-01-02T03:04:05.000Z",
      fileCount: 0,
      fileChanges: [],
    });

    expect(buildCheckpointItem(cp)).toBe(
      `ask question\n   \u001b[38;5;245mNo code changes\u001b[0m\n`,
    );
  });

  test("summarizes multiple file changes", () => {
    const cp = createEntry({
      userEntryId: "entry-1",
      beforeCommit: "before",
      prompt: "refactor",
      createdAt: "2026-01-02T03:04:05.000Z",
      fileCount: 2,
      fileChanges: [
        { path: "a.ts", added: 5, removed: 1 },
        { path: "b.ts", added: 7, removed: 2 },
      ],
    });

    expect(buildCheckpointItem(cp)).toBe(
      `refactor\n   \u001b[38;5;245m2 files changed  \u001b[38;5;2m+12\u001b[38;5;245m \u001b[38;5;1m-3\u001b[0m\n`,
    );
  });

  test("renders local checkpoint time and vertical spacing", () => {
    const cp = createEntry({
      userEntryId: "entry-1",
      beforeCommit: "before",
      prompt: "make file",
      createdAt: "2026-01-02T03:04:05.000Z",
      fileCount: 1,
      fileChanges: [{ path: "file.ts", added: 1, removed: 0 }],
    });

    expect(buildCheckpointItem(cp)).toBe(
      `make file\n   \u001b[38;5;245mfile.ts \u001b[38;5;2m+1\u001b[38;5;245m \u001b[38;5;1m-0\u001b[0m\n`,
    );
  });

  test("renders missing diff stats with singular and plural labels", () => {
    expect(
      buildCheckpointItem(
        createEntry({
          userEntryId: "entry-1",
          beforeCommit: "before",
          prompt: "one",
          fileCount: 1,
        }),
      ),
    ).toBe(`one\n   \u001b[38;5;245m1 file changed\u001b[0m\n`);
    expect(
      buildCheckpointItem(
        createEntry({
          userEntryId: "entry-2",
          beforeCommit: "before",
          prompt: "many",
          fileCount: 2,
        }),
      ),
    ).toBe(`many\n   \u001b[38;5;245m2 files changed\u001b[0m\n`);
  });

  test("formats individual change lines", () => {
    expect(formatChangeLine({ path: "file.ts", added: 2, removed: 3 })).toBe(
      "\u001b[38;5;245mfile.ts \u001b[38;5;2m+2\u001b[38;5;245m \u001b[38;5;1m-3\u001b[0m",
    );
  });

  test("handles a sparse single file change defensively", () => {
    const changes = Array.from({ length: 1 }) as CheckpointEntry["fileChanges"];
    const cp = createEntry({
      userEntryId: "entry-1",
      beforeCommit: "before",
      prompt: "sparse",
      fileCount: 1,
      fileChanges: changes,
    });

    expect(buildCheckpointItem(cp)).toBe("sparse\n   \n");
  });
});

describe("findConversationEntryIdForCheckpoint", () => {
  test("returns the turn end entry instead of the user entry", () => {
    const branch = [
      { type: "message", id: "user-1", message: { role: "user" } },
      { type: "message", id: "assistant-1", message: { role: "assistant" } },
      { type: "custom", id: "checkpoint-1", customType: "pi-checkpoint" },
      { type: "message", id: "user-2", message: { role: "user" } },
    ];

    expect(findConversationEntryIdForCheckpoint(branch, "user-1")).toBe("assistant-1");
  });

  test("falls back to user entry when checkpoint user entry is not on the branch", () => {
    expect(findConversationEntryIdForCheckpoint([], "missing-user")).toBe("missing-user");
  });

  test("ignores checkpoint custom entries and stops at the next user message", () => {
    const branch = [
      { type: "message", id: "user-1", message: { role: "user" } },
      { type: "custom", id: "checkpoint-1", customType: "pi-checkpoint" },
      { type: "message", id: "user-2", message: { role: "user" } },
      { type: "message", id: "assistant-2", message: { role: "assistant" } },
    ];

    expect(findConversationEntryIdForCheckpoint(branch, "user-1")).toBe("user-1");
  });
});

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

  test("shows only checkpoints whose user decision is on the active branch", async () => {
    const pi = createMockPi();
    const entries = [
      createEntry({ userEntryId: "branch-entry", beforeCommit: "abc", prompt: "on branch" }),
      createEntry({ userEntryId: "other-entry", beforeCommit: "def", prompt: "other branch" }),
    ];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries, ["branch-entry"]);
    ctx.ui.select.mockResolvedValueOnce(undefined);
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledWith("Rewind to checkpoint:", [
      "(current)\n",
      buildCheckpointItem(firstEntry(entries)),
    ]);
  });

  test("shows current first followed by newest checkpoints", async () => {
    const pi = createMockPi();
    const entries = [
      createEntry({ userEntryId: "old-entry", beforeCommit: "old", prompt: "old prompt" }),
      createEntry({ userEntryId: "new-entry", beforeCommit: "new", prompt: "new prompt" }),
    ];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select.mockResolvedValueOnce(undefined);
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledWith("Rewind to checkpoint:", [
      "(current)\n",
      buildCheckpointItem(entries[1] ?? firstEntry(entries)),
      buildCheckpointItem(firstEntry(entries)),
    ]);
  });

  test("returns early when user selects current", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select.mockResolvedValueOnce("(current)\n");
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    expect(ctx.navigateTree).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce(undefined);
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(2);
    expect(ctx.navigateTree).not.toHaveBeenCalled();
  });

  test("hides code restore modes when checkpoints have no file changes", async () => {
    const pi = createMockPi();
    const entries = [createEntry({ userEntryId: "e1", beforeCommit: "abc" })];
    registerRewind(pi, () => createMockRepo());
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce(undefined);
    await handler("", ctx);
    expect(ctx.ui.select).toHaveBeenLastCalledWith("Restore mode:", ["Restore conversation"]);
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce("Restore conversation");
    await handler("", ctx);
    expect(stageAll).not.toHaveBeenCalled();
    expect(checkoutCommit).not.toHaveBeenCalled();
    expect(ctx.navigateTree).toHaveBeenCalledWith("e1", { summarize: false });
  });

  test("uses matching checkpoint outside active branch as dirty guard base after clone", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi
      .fn()
      .mockImplementation((commit: string) =>
        Promise.resolve(commit === "outside-after" ? "" : "1\t0\tfile.ts\n"),
      );
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({
        userEntryId: "active-entry",
        beforeCommit: "active-before",
        afterCommit: "active-after",
        fileCount: 1,
        fileChanges: [{ path: "active.ts", added: 1, removed: 0 }],
      }),
      createEntry({
        userEntryId: "outside-entry",
        beforeCommit: "outside-before",
        afterCommit: "outside-after",
        fileCount: 1,
        fileChanges: [{ path: "outside.ts", added: 1, removed: 0 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries, ["active-entry"]);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("active-before");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("uses matching checkpoint as dirty guard base after tree navigation", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi
      .fn()
      .mockImplementation((commit: string) =>
        Promise.resolve(commit === "old-after" ? "" : "1\t0\tfile.ts\n"),
      );
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({
        userEntryId: "old-entry",
        beforeCommit: "old-before",
        afterCommit: "old-after",
        fileCount: 1,
        fileChanges: [{ path: "old.ts", added: 1, removed: 0 }],
      }),
      createEntry({
        userEntryId: "new-entry",
        beforeCommit: "new-before",
        afterCommit: "new-after",
        fileCount: 1,
        fileChanges: [{ path: "new.ts", added: 1, removed: 0 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("old-before");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("uses newest visible checkpoint as dirty guard base with newest-first display", async () => {
    const pi = createMockPi();
    const checkoutCommit = vi.fn();
    const stageAll = vi.fn();
    const diffAgainst = vi.fn().mockResolvedValue("");
    const createSafetyCommit = vi.fn().mockResolvedValue("safety");
    const entries = [
      createEntry({
        userEntryId: "old-entry",
        beforeCommit: "old-before",
        afterCommit: "old-after",
        fileCount: 1,
        fileChanges: [{ path: "old.ts", added: 1, removed: 0 }],
      }),
      createEntry({
        userEntryId: "new-entry",
        beforeCommit: "new-before",
        afterCommit: "new-after",
        fileCount: 1,
        fileChanges: [{ path: "new.ts", added: 1, removed: 0 }],
      }),
    ];
    registerRewind(pi, () =>
      createMockRepo({ checkoutCommit, stageAll, diffAgainst, createSafetyCommit }),
    );
    const handler = getRegisterCall(pi);
    const ctx = createMockCtx(entries);
    ctx.ui.select
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(diffAgainst).toHaveBeenCalledWith("new-after");
    expect(checkoutCommit).toHaveBeenCalledWith("old-before");
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
    expect(ctx.navigateTree).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
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
      .mockResolvedValueOnce(buildCheckpointItem(firstEntry(entries)))
      .mockResolvedValueOnce("Restore code");
    await handler("", ctx);
    expect(checkoutCommit).toHaveBeenCalledWith("abc");
  });
});
