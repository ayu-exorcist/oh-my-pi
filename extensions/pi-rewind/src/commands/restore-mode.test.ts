import { describe, expect, test, vi } from "vitest";
import type { CheckpointEntry, RepoManager } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import { runRestoreMode } from "./restore-mode";

function entry(
  partial: Partial<CheckpointEntry> & {
    userEntryId: string;
    beforeCommit: string;
    afterCommit: string;
  },
): CheckpointEntry {
  return {
    v: 2,
    kind: "checkpoint",
    turnId: "turn-1",
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
    select: vi.fn(),
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
      "Workspace has changes that are not captured by this session's checkpoint history. Clean them up before rewinding.",
      "warning",
    );
  });

  test("offers conversation-only fallback when code restore is blocked by workspace changes", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Restore conversation only");
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({
      ok: false,
      reason: "dirty",
      message: "Current workspace contains changes outside the target checkpoint:\n- ttt.txt",
    });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(ui.select).toHaveBeenCalledWith(
      "Current workspace contains changes outside the target checkpoint:\n- ttt.txt\n\nFiles cannot be restored safely.\n\nChoose one:",
      ["Restore conversation only", "Force restore code and conversation", "Cancel"],
    );
    expect(navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("stops after conversation-only fallback when conversation restore fails", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Restore conversation only");
    const navigateTree = vi.fn().mockRejectedValue(new Error("nav boom"));
    const repo = mockRepo({
      ok: false,
      reason: "dirty",
      message: "Current workspace contains changes outside the target checkpoint:\n- ttt.txt",
    });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith("Conversation restore failed: nav boom", "error");
    expect(ui.notify).not.toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("forces code and conversation restore after confirmation", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Force restore code and conversation");
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = createMockRepo({
      safeCheckout: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: "dirty",
          message: "Current workspace contains changes outside the target checkpoint:\n- ttt.txt",
        })
        .mockResolvedValueOnce({ ok: true }),
    });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(repo.safeCheckout).toHaveBeenNthCalledWith(1, "before", "after");
    expect(repo.safeCheckout).toHaveBeenNthCalledWith(2, "before");
    expect(navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("reports forced code restore failures after confirmation", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Force restore code and conversation");
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = createMockRepo({
      safeCheckout: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: "dirty",
          message: "Current workspace contains changes outside the target checkpoint:\n- ttt.txt",
        })
        .mockResolvedValueOnce({ ok: false, reason: "checkout-failed", error: "forced failed" }),
    });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(navigateTree).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Rewind failed: forced failed", "error");
  });

  test("stops after forced restore when conversation restore fails", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Force restore code and conversation");
    const navigateTree = vi.fn().mockRejectedValue(new Error("nav boom"));
    const repo = createMockRepo({
      safeCheckout: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: "dirty",
          message: "Current workspace contains changes outside the target checkpoint:\n- ttt.txt",
        })
        .mockResolvedValueOnce({ ok: true }),
    });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith("Conversation restore failed: nav boom", "error");
    expect(ui.notify).not.toHaveBeenCalledWith("Rewind completed", "info");
  });

  test("cancels restore when user declines dirty conflict options", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Cancel");
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({
      ok: false,
      reason: "dirty",
      message: "Current workspace contains changes outside the target checkpoint:\n- ttt.txt",
    });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(navigateTree).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  test("cancels dirty fallback when the UI cannot present a selection", async () => {
    const ui = { notify: vi.fn(), input: vi.fn() };
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: false, reason: "dirty" });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(navigateTree).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  test("reports missing checkpoint storage", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: false, reason: "storage-missing" });
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
      "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
      "warning",
    );
  });

  test("restore code and conversation warns when no checkpoint repo is available", async () => {
    const ui = createUi();
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      ui,
      navigateTree: vi.fn(),
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith(
      "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
      "warning",
    );
  });

  test("reports missing target checkpoint", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: false, reason: "target-missing" });
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
      "Files were not restored because the selected checkpoint is not present in checkpoint storage.",
      "warning",
    );
  });

  test("falls back to a generic checkout failure message", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: false, reason: "checkout-failed" });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code",
      repo,
      ui,
      navigateTree: vi.fn(),
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith("Rewind failed: checkpoint restore failed", "error");
  });

  test("restore code and conversation reports non-dirty checkout failures before prompting", async () => {
    const ui = createUi();
    const repo = mockRepo({ ok: false, reason: "checkout-failed", error: "broken" });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code and conversation",
      repo,
      ui,
      navigateTree: vi.fn(),
      targetCp: target,
      latestCp: target,
    });

    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Rewind failed: broken", "error");
  });

  test("restore code warns when no checkpoint repo is available", async () => {
    const ui = createUi();
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Restore code",
      ui,
      navigateTree: vi.fn(),
      targetCp: target,
      latestCp: target,
    });

    expect(ui.notify).toHaveBeenCalledWith(
      "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
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

  test("falls through unknown modes without checkout or navigation", async () => {
    const ui = createUi();
    const navigateTree = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ ok: true });
    const target = entry({ userEntryId: "entry-1", beforeCommit: "before", afterCommit: "after" });

    await runRestoreMode({
      mode: "Unknown mode",
      repo,
      ui,
      navigateTree,
      targetCp: target,
      latestCp: target,
    });

    expect(repo.safeCheckout).not.toHaveBeenCalled();
    expect(navigateTree).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Rewind completed", "info");
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
