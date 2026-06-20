import { describe, expect, test, vi } from "vitest";
import type { CheckpointEntry, RepoManager } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import { runRestoreMode } from "./restore-mode";

interface TestCheckpointPartial extends Partial<CheckpointEntry> {
  readonly userEntryId: string;
  readonly beforeCommit?: string;
  readonly afterCommit?: string;
}

function entry(partial: TestCheckpointPartial): CheckpointEntry {
  const beforeState = partial.beforeState ?? partial.beforeCommit;
  const afterState = partial.afterState ?? partial.afterCommit;
  if (!beforeState || !afterState) throw new Error("test checkpoint needs before/after state");
  return {
    v: 2,
    kind: "checkpoint",
    turnId: "turn-1",
    beforeState,
    afterState,
    prompt: "test",
    fileCount: 0,
    fileChanges: [],
    createdAt: "2026-01-02T03:04:05.000Z",
    ...partial,
  };
}

function createUi() {
  return {
    notify: vi.fn(),
    input: vi.fn(),
  };
}

function mockRepo(result: Awaited<ReturnType<RepoManager["safeCheckout"]>>): RepoManager {
  return createMockRepo({ safeCheckout: vi.fn().mockResolvedValue(result) });
}

describe("Rewind Restore Mode", () => {
  test("restores code and conversation", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });
    const latest = entry({
      userEntryId: "entry-2",
      beforeCommit: "latest-before",
      afterCommit: "latest-after",
    });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: latest,
    });

    expect(repo.safeCheckout).toHaveBeenCalledWith("before", "latest-after");
    expect(navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("restores code without navigating conversation", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });
    const latest = entry({
      userEntryId: "entry-2",
      beforeCommit: "latest-before",
      afterCommit: "latest-after",
    });

    await runRestoreMode({
      mode: "Restore code",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: latest,
    });

    expect(repo.safeCheckout).toHaveBeenCalledWith("before", "latest-after");
    expect(navigateTree).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("restores code and conversation via shared restore path", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });
    const latest = entry({
      userEntryId: "entry-2",
      beforeCommit: "latest-before",
      afterCommit: "latest-after",
    });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: latest,
    });

    expect(repo.safeCheckout).toHaveBeenCalledWith("before", "latest-after");
    expect(navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("reports Dirty Workspace", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: false, reason: "dirty" });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code",
      repo,
      ui,
      navigateTree: vi.fn(),
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before rewinding.",
      "warning",
    );
  });

  test("reports conversation failure", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore conversation",
      repo,
      ui,
      navigateTree: vi.fn().mockRejectedValue(new Error("nav error")),
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith("Conversation restore failed: nav error", "error");
  });

  test("restores conversation without checkout", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(repo.safeCheckout).not.toHaveBeenCalled();
    expect(navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
  });

  test("code restore uses explicit conversation and dirty base ids", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });
    const latest = entry({
      userEntryId: "latest",
      beforeCommit: "latest-before",
      afterCommit: "latest-after",
    });

    await runRestoreMode({
      mode: "Restore code",
      repo,
      ui,
      navigateTree: vi.fn(),
      targetCp: target,
      latestCp: latest,
      conversationEntryId: "assistant-entry",
      dirtyBaseCommit: "clean-base",
    });

    expect(repo.safeCheckout).toHaveBeenCalledWith("before", "clean-base");
  });
});
