import { describe, expect, test, vi } from "vitest";
import type { RepoManager } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import { restoreRedoTarget, restoreUndoTarget } from "./restore";

type NotifyLevel = "info" | "warning" | "error";

interface TestUi {
  readonly notify: ((message: string, level: NotifyLevel) => void) & ReturnType<typeof vi.fn>;
}

function createUi(): TestUi {
  return { notify: vi.fn<(message: string, level: NotifyLevel) => void>() };
}

function mockRepo(result: Awaited<ReturnType<RepoManager["safeCheckout"]>>): RepoManager {
  return createMockRepo({ safeCheckout: vi.fn().mockResolvedValue(result) });
}

describe("UndoRedo restore", () => {
  test("restoreUndoTarget checks out and navigates", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });

    const result = await restoreUndoTarget({
      repo,
      ui,
      navigateTree,
      targetCommit: "before",
      dirtyBaseCommit: "after",
      targetLeafId: "entry-1",
    });

    expect(result).toEqual({ ok: true });
    expect(repo.safeCheckout).toHaveBeenCalledWith("before", "after");
    expect(navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith(
      "Undo complete. Workspace restored to before that turn.",
      "info",
    );
  });

  test("restoreUndoTarget reports checkout failure", async () => {
    const ui = createUi();

    const result = await restoreUndoTarget({
      repo: mockRepo({ ok: false, reason: "checkout-failed", error: "git error" }),
      ui,
      navigateTree: vi.fn(),
      targetCommit: "before",
      dirtyBaseCommit: "after",
      targetLeafId: "entry-1",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith("Undo failed: git error", "error");
  });

  test("restoreUndoTarget reports rollback failure", async () => {
    const ui = createUi();

    const result = await restoreUndoTarget({
      repo: mockRepo({
        ok: false,
        reason: "checkout-failed",
        error: "git error",
        rollbackError: "rollback error",
      }),
      ui,
      navigateTree: vi.fn(),
      targetCommit: "before",
      dirtyBaseCommit: "after",
      targetLeafId: "entry-1",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith(
      "Undo failed and rollback also failed: rollback error",
      "error",
    );
  });

  test("restoreUndoTarget reports conversation failure", async () => {
    const ui = createUi();

    const result = await restoreUndoTarget({
      repo: mockRepo({ ok: true }),
      ui,
      navigateTree: vi.fn().mockRejectedValue(new Error("nav error")),
      targetCommit: "before",
      dirtyBaseCommit: "after",
      targetLeafId: "entry-1",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith("Conversation restore failed: nav error", "error");
  });

  test("restoreUndoTarget reports non-Error conversation failure", async () => {
    const ui = createUi();

    const result = await restoreUndoTarget({
      repo: mockRepo({ ok: true }),
      ui,
      navigateTree: vi.fn().mockRejectedValue("string nav error"),
      targetCommit: "before",
      dirtyBaseCommit: "after",
      targetLeafId: "entry-1",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith(
      "Conversation restore failed: string nav error",
      "error",
    );
  });

  test("restoreRedoTarget uses Redo messages", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });

    const result = await restoreRedoTarget({
      repo,
      ui,
      navigateTree,
      targetCommit: "after",
      dirtyBaseCommit: "latest-after",
      targetLeafId: "leaf-1",
    });

    expect(result).toEqual({ ok: true });
    expect(repo.safeCheckout).toHaveBeenCalledWith("after", "latest-after");
    expect(navigateTree).toHaveBeenCalledWith("leaf-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith("Redo complete. Workspace restored.", "info");
  });

  test("restoreRedoTarget supports missing dirty base commit", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });

    const result = await restoreRedoTarget({
      repo,
      ui,
      navigateTree,
      targetCommit: "after",
      dirtyBaseCommit: undefined,
      targetLeafId: "leaf-1",
    });

    expect(result).toEqual({ ok: true });
    expect(repo.safeCheckout).toHaveBeenCalledWith("after", undefined);
  });

  test("restoreRedoTarget reports Dirty Workspace with Redo text", async () => {
    const ui = createUi();

    const result = await restoreRedoTarget({
      repo: mockRepo({ ok: false, reason: "dirty" }),
      ui,
      navigateTree: vi.fn(),
      targetCommit: "after",
      dirtyBaseCommit: "latest-after",
      targetLeafId: "leaf-1",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before redoing.",
      "warning",
    );
  });

  test("restoreUndoTarget reports Dirty Workspace", async () => {
    const ui = createUi();
    const navigateTree = vi.fn();

    const result = await restoreUndoTarget({
      repo: mockRepo({ ok: false, reason: "dirty" }),
      ui,
      navigateTree,
      targetCommit: "before",
      dirtyBaseCommit: "after",
      targetLeafId: "entry-1",
    });

    expect(result).toEqual({ ok: false });
    expect(navigateTree).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before undoing.",
      "warning",
    );
  });
});
