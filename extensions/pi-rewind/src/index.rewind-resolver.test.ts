import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RepoManager } from "@ayulab/pi-checkpoint";

type MockEventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

function createMockApi(): {
  api: ExtensionAPI;
  events: Record<string, Array<MockEventHandler>>;
} {
  const events: Record<string, Array<MockEventHandler>> = {};
  const api = {
    on: (event: string, handler: MockEventHandler) => {
      events[event] = events[event] || [];
      events[event].push(handler);
    },
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;

  return { api, events };
}

function createUserEntry(id: string, text: string) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

function createAssistantMessage() {
  return {
    role: "assistant",
    content: [],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

async function emitAssistantStart(
  events: Record<string, Array<MockEventHandler>>,
  ctx: ExtensionContext,
): Promise<void> {
  const message = createAssistantMessage();
  for (const handler of events["message_start"] || []) {
    await handler({ message }, ctx);
  }
}

function createMockContext(
  sessionFile: string,
  cwd: string,
  sessionId = "test-session",
  branch: readonly unknown[] = [createUserEntry("entry-1", "test")],
) {
  return {
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => sessionId,
      getBranch: () => branch,
      getEntries: () => branch,
    },
    cwd,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      setWidget: vi.fn(),
    },
    hasUI: true,
  } as unknown as ExtensionContext;
}

describe("rewind resolver", () => {
  let tmpDir: string;
  let sessionFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-rewind-resolver-test-"));
    sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "session.jsonl");
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, "", "utf8");
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("./commands/rewind");
    vi.doUnmock("./commands/checkpoint");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("registerRewind resolver reports not-ready, missing storage, success, and unusable storage", async () => {
    const rewindRegistrations: Array<{
      getRepo: (sessionId: string) => Promise<unknown>;
      getSyncedCodeCommit: (sessionId: string) => string | undefined;
      setSyncedCodeCommit: (sessionId: string, commitHash: string) => void;
    }> = [];

    vi.doMock("./commands/rewind", () => ({
      registerRewind: vi.fn(
        (
          _pi: ExtensionAPI,
          getRepo: (sessionId: string) => Promise<unknown>,
          _suppress: (sessionId: string) => void,
          _restore: (sessionId: string) => void,
          getSyncedCodeCommit: (sessionId: string) => string | undefined,
          setSyncedCodeCommit: (sessionId: string, commitHash: string) => void,
        ) => {
          rewindRegistrations.push({ getRepo, getSyncedCodeCommit, setSyncedCodeCommit });
        },
      ),
    }));
    vi.doMock("./commands/checkpoint", () => ({
      registerCheckpointStorageCommand: vi.fn(),
    }));

    const { default: activate } = await import("./index");
    const { api, events } = createMockApi();
    activate(api);

    const registration = rewindRegistrations[0];
    if (!registration) throw new Error("expected rewind registration");

    await expect(registration.getRepo("missing-session")).resolves.toEqual({
      ok: false,
      message: "Checkpoint extension is not ready for this session.",
      level: "warning",
    });

    const ctx = createMockContext(sessionFile, tmpDir);
    for (const handler of events["session_start"] || []) {
      await handler({ reason: "new" }, ctx);
    }

    await expect(registration.getRepo("test-session")).resolves.toEqual({
      ok: false,
      message:
        "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
      level: "warning",
    });

    await emitAssistantStart(events, ctx);
    const success = (await registration.getRepo("test-session")) as
      | { ok: true; repo: RepoManager }
      | { ok: false };
    expect(success).toMatchObject({ ok: true });
    if (!success.ok) throw new Error("expected repo success");

    expect(registration.getSyncedCodeCommit("test-session")).toBeUndefined();
    registration.setSyncedCodeCommit("test-session", "rewind-restored-commit");
    expect(registration.getSyncedCodeCommit("test-session")).toBe("rewind-restored-commit");

    vi.spyOn(success.repo, "lockedSetExclude").mockRejectedValueOnce(new Error("boom"));
    await expect(registration.getRepo("test-session")).resolves.toEqual({
      ok: false,
      message: "Checkpoint storage could not be prepared for rewind: boom",
      level: "error",
    });
  }, 15000);

  test("session_tree skips checkout when rewind marks the target code commit as synced", async () => {
    const rewindRegistrations: Array<{
      setSyncedCodeCommit: (sessionId: string, commitHash: string) => void;
    }> = [];

    vi.doMock("./commands/rewind", () => ({
      registerRewind: vi.fn(
        (
          _pi: ExtensionAPI,
          _getRepo: (sessionId: string) => Promise<unknown>,
          _suppress: (sessionId: string) => void,
          _restore: (sessionId: string) => void,
          _getSyncedCodeCommit: (sessionId: string) => string | undefined,
          setSyncedCodeCommit: (sessionId: string, commitHash: string) => void,
        ) => {
          rewindRegistrations.push({ setSyncedCodeCommit });
        },
      ),
    }));
    vi.doMock("./commands/checkpoint", () => ({
      registerCheckpointStorageCommand: vi.fn(),
    }));

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { rewind: { restoreOnTree: "always" } } }),
      "utf8",
    );

    const checkpointEntry = {
      v: 2,
      kind: "checkpoint",
      turnId: "turn-1",
      userEntryId: "entry-1",
      beforeCommit: "tree-before",
      afterCommit: "tree-after",
      prompt: "test",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      createdAt: "2026-01-02T03:04:05.000Z",
    };
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];

    const { default: activate } = await import("./index");
    const { api, events } = createMockApi();
    activate(api);
    const registration = rewindRegistrations[0];
    if (!registration) throw new Error("expected rewind registration");

    const ctx = createMockContext(sessionFile, tmpDir, "test-session", branch);
    for (const handler of events["session_start"] || []) {
      await handler({ reason: "new" }, ctx);
    }

    registration.setSyncedCodeCommit("test-session", "stale-code");
    for (const handler of events["session_before_tree"] || []) {
      await handler({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }

    registration.setSyncedCodeCommit("test-session", "tree-before");
    vi.mocked(ctx.ui.notify).mockClear();
    vi.mocked(ctx.ui.setWidget).mockClear();
    const safeCheckout = vi.spyOn(RepoManager.prototype, "safeCheckout");
    for (const handler of events["session_tree"] || []) {
      await handler({ oldLeafId: "entry-1", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });
});
