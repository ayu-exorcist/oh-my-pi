import { describe, expect, test, vi } from "vitest";
import { safeRestore } from "./restore";
import type { RepoManager } from "./repo-manager";

describe("safeRestore", () => {
  function createMockRepo(
    result:
      | {
          ok: true;
          safetyHash?: string;
        }
      | {
          ok: false;
          reason: "dirty";
        }
      | {
          ok: false;
          reason: "dirty-check-failed";
          error: string;
        }
      | {
          ok: false;
          reason: "checkout-failed";
          error: string;
          rollbackError?: string;
        },
  ): RepoManager {
    return {
      safeCheckout: vi.fn().mockResolvedValue(result),
    } as unknown as RepoManager;
  }

  function createMockUi() {
    return { notify: vi.fn() };
  }

  function createMockNavigateTree() {
    return vi.fn().mockResolvedValue(undefined);
  }

  test("returns ok on successful checkout and navigation", async () => {
    const repo = createMockRepo({ ok: true });
    const ui = createMockUi();
    const navigateTree = createMockNavigateTree();

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: "def456",
      targetLeafId: "leaf-1",
      dirtyMessage: "dirty",
      failedPrefix: "failed",
      rollbackFailedPrefix: "rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: true });
    expect(repo.safeCheckout).toHaveBeenCalledWith("abc123", "def456");
    expect(navigateTree).toHaveBeenCalledWith("leaf-1", { summarize: false });
    expect(ui.notify).toHaveBeenCalledWith("success", "info");
  });

  test("returns failure on dirty workspace", async () => {
    const repo = createMockRepo({ ok: false, reason: "dirty" });
    const ui = createMockUi();
    const navigateTree = createMockNavigateTree();

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: "def456",
      targetLeafId: "leaf-1",
      dirtyMessage: "workspace is dirty",
      failedPrefix: "failed",
      rollbackFailedPrefix: "rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith("workspace is dirty", "warning");
    expect(navigateTree).not.toHaveBeenCalled();
  });

  test("returns failure when workspace cleanliness cannot be verified", async () => {
    const repo = createMockRepo({
      ok: false,
      reason: "dirty-check-failed",
      error: "verify failed",
    });
    const ui = createMockUi();
    const navigateTree = createMockNavigateTree();

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: "def456",
      targetLeafId: "leaf-1",
      dirtyMessage: "workspace is dirty",
      failedPrefix: "failed",
      rollbackFailedPrefix: "rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith(
      "Workspace cleanliness could not be verified: verify failed",
      "error",
    );
    expect(navigateTree).not.toHaveBeenCalled();
  });

  test("returns failure on checkout error", async () => {
    const repo = createMockRepo({ ok: false, reason: "checkout-failed", error: "git error" });
    const ui = createMockUi();
    const navigateTree = createMockNavigateTree();

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: "def456",
      targetLeafId: "leaf-1",
      dirtyMessage: "dirty",
      failedPrefix: "Checkout failed",
      rollbackFailedPrefix: "Rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith("Checkout failed: git error", "error");
  });

  test("returns failure on rollback error", async () => {
    const repo = createMockRepo({
      ok: false,
      reason: "checkout-failed",
      error: "git error",
      rollbackError: "rollback also failed",
    });
    const ui = createMockUi();
    const navigateTree = createMockNavigateTree();

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: "def456",
      targetLeafId: "leaf-1",
      dirtyMessage: "dirty",
      failedPrefix: "Checkout failed",
      rollbackFailedPrefix: "Rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith("Rollback failed: rollback also failed", "error");
  });

  test("returns failure on navigation error", async () => {
    const repo = createMockRepo({ ok: true });
    const ui = createMockUi();
    const navigateTree = vi.fn().mockRejectedValue(new Error("nav failed"));

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: "def456",
      targetLeafId: "leaf-1",
      dirtyMessage: "dirty",
      failedPrefix: "failed",
      rollbackFailedPrefix: "rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: false });
    expect(ui.notify).toHaveBeenCalledWith("Conversation restore failed: nav failed", "error");
  });

  test("allows undefined dirtyBaseCommit", async () => {
    const repo = createMockRepo({ ok: true });
    const ui = createMockUi();
    const navigateTree = createMockNavigateTree();

    const result = await safeRestore({
      repo,
      ui,
      navigateTree,
      targetCommit: "abc123",
      dirtyBaseCommit: undefined,
      targetLeafId: "leaf-1",
      dirtyMessage: "dirty",
      failedPrefix: "failed",
      rollbackFailedPrefix: "rollback failed",
      successMessage: "success",
    });

    expect(result).toEqual({ ok: true });
    expect(repo.safeCheckout).toHaveBeenCalledWith("abc123", undefined);
  });
});
