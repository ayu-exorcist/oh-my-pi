import { describe, test, expect, vi } from "vitest";
import fs from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { RepoManager, RepoProvider } from "@ayulab/pi-checkpoint";
import { createDefaultRepoProvider } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import defaultFactory from "./index";

function createMockApi(): {
  api: ExtensionAPI;
  events: Record<string, Array<(...args: unknown[]) => unknown>>;
  registerCommand: ReturnType<typeof vi.fn>;
} {
  const events: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const registerCommand = vi.fn();

  const api = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      events[event] = events[event] || [];
      events[event].push(handler);
    },
    registerCommand,
  } as unknown as ExtensionAPI;

  return { api, events, registerCommand };
}

function createMockSessionManager(sessionFile: string, entries: unknown[] = []) {
  return {
    getSessionFile: () => sessionFile,
    getSessionId: () => "test-session",
    getLeafId: () => "leaf-1",
    getEntries: () => entries,
  };
}

function createCheckpointEntry(
  userEntryId: string,
  beforeCommit: string,
  afterCommit: string,
): unknown {
  return {
    type: "custom",
    customType: "pi-checkpoint",
    data: {
      v: 2,
      kind: "checkpoint",
      turnId: "turn-1",
      userEntryId,
      beforeCommit,
      afterCommit,
      prompt: "test",
      fileCount: 0,
      fileChanges: [],
      createdAt: new Date().toISOString(),
    },
  };
}

function createMockProvider(): RepoProvider {
  const repos = new Map<string, RepoManager>();
  return {
    getRepo: (id: string) => repos.get(id),
    setRepo: (id: string, repo: RepoManager) => repos.set(id, repo),
    deleteRepo: (id: string) => repos.delete(id),
  };
}

// Helper alias to keep test code readable while using the shared adapter.
const mockRepo = createMockRepo;

describe("undoredo extension", () => {
  test("registers /undo and /redo commands", async () => {
    const { api, registerCommand } = createMockApi();
    defaultFactory(api, createMockProvider());

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    expect(undoCall).toBeDefined();
    expect(redoCall).toBeDefined();
  });

  test("defaultFactory works without an explicit provider", async () => {
    const { api, registerCommand } = createMockApi();
    defaultFactory(api);

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    expect(undoCall).toBeDefined();
  });

  test("session_start does nothing when git does not exist", async () => {
    const { api, events } = createMockApi();
    const provider = createMockProvider();
    defaultFactory(api, provider);

    const ctx = {
      sessionManager: {
        getSessionId: () => "missing-session",
        getSessionFile: () => "/nonexistent/missing-session.jsonl",
      },
      cwd: "/nonexistent",
      ui: { notify: vi.fn() },
      hasUI: true,
    } as unknown as ExtensionCommandContext;

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    expect(provider.getRepo("missing-session")).toBeUndefined();
  });

  test("session_start binds repo when git directory exists", async () => {
    const { api, events } = createMockApi();
    const provider = createMockProvider();
    defaultFactory(api, provider);

    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);

    const ctx = {
      sessionManager: {
        getSessionId: () => "existing-session",
        getSessionFile: () => "/fake/session.jsonl",
      },
      cwd: "/fake",
      ui: { notify: vi.fn() },
      hasUI: true,
    } as unknown as ExtensionCommandContext;

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    expect(provider.getRepo("existing-session")).toBeDefined();

    accessSpy.mockRestore();
  });

  test("undo warns when repo not ready", async () => {
    const { api, registerCommand } = createMockApi();
    defaultFactory(api, createMockProvider());

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager(""),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Checkpoint extension not ready", "warning");
  });

  test("undo no-op when no checkpoints", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    provider.setRepo("test-session", mockRepo({}));
    defaultFactory(api, provider);

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager(""),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Nothing to undo.", "info");
  });

  test("undo restores code and conversation", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(repo.checkoutCommit).toHaveBeenCalledWith("abc");
    expect(cmdCtx.navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Undo complete. Workspace restored to before that turn.",
      "info",
    );
  });

  test("undo dirty guard blocks when workspace has changes", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue("1\t0\tfile.ts\n"),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before undoing.",
      "warning",
    );
  });

  test("undo handles checkout failure with rollback", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi
        .fn()
        .mockRejectedValueOnce(new Error("git error"))
        .mockResolvedValueOnce(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(repo.checkoutCommit).toHaveBeenCalledWith("abc");
    expect(repo.checkoutCommit).toHaveBeenCalledWith("safety");
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Undo failed: git error", "error");
  });

  test("undo handles checkout failure without safety commit", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockRejectedValue(new Error("safety failed")),
      checkoutCommit: vi.fn().mockRejectedValue(new Error("git error")),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Undo failed: git error", "error");
  });

  test("undo skips redo stack push when no current leaf", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: {
        ...createMockSessionManager("", entries),
        getLeafId: () => undefined,
      },
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Undo complete. Workspace restored to before that turn.",
      "info",
    );
  });

  test("undo handles non-Error checkout failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi
        .fn()
        .mockRejectedValueOnce("string error")
        .mockResolvedValueOnce(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Undo failed: string error", "error");
  });

  test("undo handles rollback failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi
        .fn()
        .mockRejectedValueOnce(new Error("git error"))
        .mockRejectedValueOnce(new Error("rollback error")),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Undo failed and rollback also failed: rollback error",
      "error",
    );
  });

  test("undo handles non-Error rollback failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi
        .fn()
        .mockRejectedValueOnce(new Error("git error"))
        .mockRejectedValueOnce("string rollback"),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Undo failed and rollback also failed: string rollback",
      "error",
    );
  });

  test("undo handles navigateTree failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockRejectedValue(new Error("nav error")),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Conversation restore failed: nav error",
      "error",
    );
  });

  test("undo handles non-Error navigateTree failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockRejectedValue("string nav"),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith(
      "Conversation restore failed: string nav",
      "error",
    );
  });

  test("redo warns when repo not ready", async () => {
    const { api, registerCommand } = createMockApi();
    defaultFactory(api, createMockProvider());

    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const handler = redoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager(""),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Checkpoint extension not ready", "warning");
  });

  test("redo no-op when stack empty", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    provider.setRepo("test-session", mockRepo({}));
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const handler = redoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Nothing to redo.", "info");
  });

  test("redo restores code and conversation", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // First undo to populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Then redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(repo.checkoutCommit).toHaveBeenCalledWith("def");
    expect(redoCtx.navigateTree).toHaveBeenCalledWith("leaf-1", { summarize: false });
    expect(redoCtx.ui.notify).toHaveBeenCalledWith("Redo complete. Workspace restored.", "info");
  });

  test("redo dirty guard blocks when workspace has changes", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // First undo with clean repo to populate redo stack
    const cleanRepo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", cleanRepo);
    defaultFactory(api, provider);

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Then set dirty repo for redo
    const dirtyRepo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue("1\t0\tfile.ts\n"),
    });
    provider.setRepo("test-session", dirtyRepo);

    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before redoing.",
      "warning",
    );
  });

  test("redo handles checkout failure with rollback", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockImplementation((hash: string) => {
        if (hash === "def") return Promise.reject(new Error("git error"));
        return Promise.resolve(undefined);
      }),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(repo.checkoutCommit).toHaveBeenCalledWith("def");
    expect(repo.checkoutCommit).toHaveBeenCalledWith("safety");
    expect(redoCtx.ui.notify).toHaveBeenCalledWith("Redo failed: git error", "error");
  });

  test("redo handles checkout failure without safety commit", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockRejectedValue(new Error("safety failed")),
      checkoutCommit: vi.fn().mockImplementation((hash: string) => {
        if (hash === "def") return Promise.reject(new Error("git error"));
        return Promise.resolve(undefined);
      }),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith("Redo failed: git error", "error");
  });

  test("redo handles non-Error checkout failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockImplementation((hash: string) => {
        if (hash === "def") return Promise.reject("string error");
        return Promise.resolve(undefined);
      }),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith("Redo failed: string error", "error");
  });

  test("redo handles rollback failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockImplementation((hash: string) => {
        if (hash === "abc") return Promise.resolve(undefined);
        if (hash === "def") return Promise.reject(new Error("git error"));
        if (hash === "safety") return Promise.reject(new Error("rollback error"));
        return Promise.resolve(undefined);
      }),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith(
      "Redo failed and rollback also failed: rollback error",
      "error",
    );
  });

  test("redo handles non-Error rollback failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockImplementation((hash: string) => {
        if (hash === "abc") return Promise.resolve(undefined);
        if (hash === "def") return Promise.reject(new Error("git error"));
        if (hash === "safety") return Promise.reject("string rollback");
        return Promise.resolve(undefined);
      }),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith(
      "Redo failed and rollback also failed: string rollback",
      "error",
    );
  });

  test("redo handles navigateTree failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockRejectedValue(new Error("nav error")),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith(
      "Conversation restore failed: nav error",
      "error",
    );
  });

  test("redo handles non-Error navigateTree failure", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockRejectedValue("string nav"),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(redoCtx.ui.notify).toHaveBeenCalledWith(
      "Conversation restore failed: string nav",
      "error",
    );
  });

  test("redo skips dirty guard when no checkpoints exist", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo with empty checkpoints
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", []),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(repo.checkoutCommit).toHaveBeenCalledWith("def");
    expect(redoCtx.ui.notify).toHaveBeenCalledWith("Redo complete. Workspace restored.", "info");
  });

  test("redo handles dirty guard failure gracefully", async () => {
    const { api, registerCommand } = createMockApi();
    const provider = createMockProvider();
    const repo = mockRepo({
      stageAll: vi.fn().mockRejectedValue(new Error("stage failed")),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    provider.setRepo("test-session", repo);
    defaultFactory(api, provider);

    const entries = [createCheckpointEntry("entry-1", "abc", "def")];

    // Populate redo stack
    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const undoHandler = undoCall[1].handler;

    const undoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await undoHandler("", undoCtx);

    // Redo
    const redoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "redo");
    if (!redoCall) throw new Error("redo command not registered");
    const redoHandler = redoCall[1].handler;

    const redoCtx = {
      ui: { notify: vi.fn() },
      sessionManager: createMockSessionManager("", entries),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    await redoHandler("", redoCtx);
    expect(repo.createSafetyCommit).toHaveBeenCalled();
    expect(redoCtx.ui.notify).toHaveBeenCalledWith("Redo complete. Workspace restored.", "info");
  });

  test("session_shutdown removes repo", async () => {
    const { api, events, registerCommand } = createMockApi();
    const provider = createMockProvider();
    provider.setRepo("test-session", mockRepo({}));
    defaultFactory(api, provider);

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "quit" }, {
        sessionManager: { getSessionId: () => "test-session" },
      } as unknown as ExtensionCommandContext);
    }

    const undoCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "undo");
    if (!undoCall) throw new Error("undo command not registered");
    const handler = undoCall[1].handler;

    const cmdCtx = {
      ui: { notify: vi.fn() },
      sessionManager: { getSessionId: () => "test-session" },
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.notify).toHaveBeenCalledWith("Checkpoint extension not ready", "warning");
  });

  test("createDefaultRepoProvider isolates sessions", () => {
    const p = createDefaultRepoProvider();
    const repo = mockRepo({});
    p.setRepo("a", repo);
    expect(p.getRepo("a")).toBe(repo);
    expect(p.getRepo("b")).toBeUndefined();
    p.deleteRepo("a");
    expect(p.getRepo("a")).toBeUndefined();
  });
});
