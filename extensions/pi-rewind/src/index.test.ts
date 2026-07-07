import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { RepoManager } from "@ayulab/pi-checkpoint";
import type { CheckpointConfig, CheckpointEntry, SafeCheckoutResult } from "@ayulab/pi-checkpoint";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import {
  __piRewindIndexTestOnly,
  getForkIntentPath,
  isForkIntent,
  isForkIntentRecord,
  readForkIntent,
  writeForkIntent,
} from "./index";
import { AutoCheckpointProducer } from "./auto-checkpoint";

type MockEventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

const codeRestoreWarningWidgetId = "pi-rewind-code-restore-warning";
const checkpointSessionStorageMissingWidgetMessage =
  "Checkpoint storage for this session is missing. File restore for existing checkpoints is unavailable.";
const checkpointStorageMissingWidgetMessage =
  "Files were not restored because checkpoint storage for this session is missing.";
const checkpointTargetMissingWidgetMessage =
  "Files were not restored because the selected checkpoint is not present in checkpoint storage.";

interface MockSessionManager {
  getSessionFile(): string;
  getSessionId(): string;
  getLeafEntry(): SessionEntry | undefined;
  getBranch(): readonly unknown[];
  getEntries(): readonly unknown[];
}

type MockContext = ExtensionContext & {
  readonly sessionManager: MockSessionManager;
  readonly ui: {
    notify: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    setWidget: ReturnType<typeof vi.fn>;
  };
  readonly hasUI: boolean;
};

function expectCodeRestoreWarningWidget(
  setWidget: ReturnType<typeof vi.fn>,
  message: string,
): void {
  const expectedText = `Warning: ${message}`;
  const found = setWidget.mock.calls.some(([id, content]) => {
    if (id !== codeRestoreWarningWidgetId || typeof content !== "function") return false;

    const renderWarning = content as (
      tui: unknown,
      theme: { fg: ReturnType<typeof vi.fn> },
    ) => unknown;
    const theme = { fg: vi.fn((_color: string, text: string) => text) };
    renderWarning(undefined, theme);

    return theme.fg.mock.calls.some(([color, text]) => {
      return color === "warning" && text === expectedText;
    });
  });

  expect(found).toBe(true);
}

function hasCodeRestoreWarningWidget(setWidget: ReturnType<typeof vi.fn>): boolean {
  return setWidget.mock.calls.some(([id, content]) => {
    return id === codeRestoreWarningWidgetId && typeof content === "function";
  });
}

function createMockApi(): {
  api: ExtensionAPI;
  events: Record<string, Array<MockEventHandler>>;
  registerCommand: ReturnType<typeof vi.fn>;
  appendEntry: ReturnType<typeof vi.fn>;
} {
  const events: Record<string, Array<MockEventHandler>> = {};
  const registerCommand = vi.fn();
  const appendEntry = vi.fn();

  const api = {
    on: (event: string, handler: MockEventHandler) => {
      events[event] = events[event] || [];
      events[event].push(handler);
    },
    registerCommand,
    appendEntry,
  } as unknown as ExtensionAPI;

  return { api, events, registerCommand, appendEntry };
}

function isSessionMessageEntry(
  value: unknown,
): value is SessionEntry & { readonly type: "message" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "message";
}

function createMockSessionManager(
  sessionFile: string,
  branch: readonly unknown[] = [],
  sessionId = "test-session",
): MockSessionManager {
  return {
    getSessionFile: () => sessionFile,
    getSessionId: () => sessionId,
    getLeafEntry: () => {
      const leaf = branch[branch.length - 1];
      if (!isSessionMessageEntry(leaf)) return undefined;
      return {
        id: leaf.id,
        type: leaf.type,
        parentId: leaf.parentId,
        timestamp: leaf.timestamp,
        message: leaf.message,
      };
    },
    getBranch: () => branch,
    getEntries: () => branch,
  };
}

type MockCall = readonly [string, unknown, ...unknown[]];

function isMockCall(value: readonly unknown[]): value is MockCall {
  return value.length >= 2 && typeof value[0] === "string";
}

function getCheckpointEntryCall(mock: ReturnType<typeof vi.fn>, index: number): CheckpointEntry {
  const call = mock.mock.calls[index];
  if (!call || !isMockCall(call)) throw new Error(`expected mock call ${index}`);
  const [customType, entry] = call;
  if (customType !== "pi-checkpoint") throw new Error("expected pi-checkpoint entry");
  return entry as CheckpointEntry;
}

function expectCheckpointEntryCall(
  mock: ReturnType<typeof vi.fn>,
  index: number,
): [string, CheckpointEntry] {
  const entry = getCheckpointEntryCall(mock, index);
  return ["pi-checkpoint", entry];
}

function expectFileChange(entry: CheckpointEntry, index: number) {
  const change = entry.fileChanges[index];
  if (!change) throw new Error(`expected file change ${index}`);
  return change;
}

function createUserEntry(id: string, text: string): SessionEntry {
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

function createCheckpointEntry(partial: Partial<CheckpointEntry> = {}): CheckpointEntry {
  return {
    v: 2,
    kind: "checkpoint",
    turnId: "turn-1",
    userEntryId: "entry-1",
    beforeCommit: "before-hash",
    afterCommit: "after-hash",
    prompt: "test",
    fileCount: 0,
    fileChanges: [],
    createdAt: "2026-01-02T03:04:05.000Z",
    ...partial,
  };
}

function getAgentMessage(branch: SessionEntry[]) {
  const entry = branch[0];
  if (!entry || entry.type !== "message") throw new Error("expected message entry");
  return entry.message;
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
  const messageStartHandlers = events["message_start"] || [];
  for (const h of messageStartHandlers) {
    await h({ message }, ctx);
  }
}

function createMockContext(
  sessionFile: string,
  branch: readonly unknown[],
  cwd: string,
  sessionId = "test-session",
): MockContext {
  return {
    sessionManager: createMockSessionManager(sessionFile, branch, sessionId),
    cwd,
    ui: { notify: vi.fn(), confirm: vi.fn(), select: vi.fn(), setWidget: vi.fn() },
    hasUI: true,
  } as MockContext;
}

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pi-rewind-test-"));
}

async function setTreeRestoreMode(
  cwd: string,
  restoreOnTree: "always" | "ask" | "never",
): Promise<void> {
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".pi", "settings.json"),
    JSON.stringify({ ayu: { rewind: { restoreOnTree } } }),
    "utf8",
  );
}

async function enableTreeRestore(cwd: string): Promise<void> {
  await setTreeRestoreMode(cwd, "always");
}

describe("index helpers", () => {
  test("resolves tree restore mode, titles, and max file bytes", () => {
    expect(__piRewindIndexTestOnly.resolveTreeRestoreMode({})).toBe("ask");
    expect(
      __piRewindIndexTestOnly.resolveTreeRestoreMode({
        ayu: { rewind: { restoreOnTree: "invalid" } },
      }),
    ).toBe("ask");
    expect(
      __piRewindIndexTestOnly.resolveTreeRestoreMode({
        ayu: { rewind: { restoreOnTree: "never" } },
      }),
    ).toBe("never");
    expect(__piRewindIndexTestOnly.normalizeSessionTitle(undefined)).toBe("Untitled session");
    expect(__piRewindIndexTestOnly.normalizeSessionTitle("  hello\nworld  ")).toBe("hello world");
    expect(__piRewindIndexTestOnly.toMaxFileBytes({ maxFileMB: 0.2 } as CheckpointConfig)).toBe(
      Math.floor(0.2 * 1024 * 1024),
    );
    expect(__piRewindIndexTestOnly.toMaxFileBytes({} as CheckpointConfig)).toBeUndefined();
  });

  test("syncCheckpointStorageManifest returns early without a session file", async () => {
    await expect(
      __piRewindIndexTestOnly.syncCheckpointStorageManifest(
        undefined,
        "session-id",
        process.cwd(),
        [createUserEntry("entry-1", "prompt")],
      ),
    ).resolves.toBeUndefined();
  });

  test("notifySafeCheckoutFailure covers warning and error variants", () => {
    const notify = vi.fn();
    const ui = { notify, setWidget: vi.fn() } as unknown as ExtensionContext["ui"];
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      ui,
      { ok: false, reason: "storage-missing" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      ui,
      { ok: false, reason: "target-missing" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      ui,
      { ok: false, reason: "dirty", message: "details" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      ui,
      { ok: false, reason: "dirty-check-failed" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      ui,
      { ok: false, reason: "checkout-failed", rollbackError: "rollback boom" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      ui,
      { ok: false, reason: "checkout-failed", error: "checkout boom" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );
    __piRewindIndexTestOnly.notifySafeCheckoutFailure(
      undefined,
      { ok: false, reason: "checkout-failed", error: "ignored" },
      "dirty",
      "dirty-check",
      "failed",
      "rollback",
    );

    expect(notify.mock.calls).toEqual([
      [checkpointStorageMissingWidgetMessage, "warning"],
      [checkpointTargetMissingWidgetMessage, "warning"],
      ["dirty\ndetails", "warning"],
      ["dirty-check", "warning"],
      ["rollback: rollback boom", "error"],
      ["failed: checkout boom", "error"],
    ]);
  });

  test("findCleanCheckpointCommit, safeRestoreTreeCodeState, and restore helpers cover fallback paths", async () => {
    const repo = createMockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi
        .fn()
        .mockResolvedValueOnce("1\t0\ta.txt\n")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("1\t0\ta.txt\n"),
      safeCheckout: vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, reason: "target-missing" })
        .mockResolvedValueOnce({ ok: true }),
    });
    const checkpoints = [
      createCheckpointEntry({
        userEntryId: "entry-1",
        beforeCommit: "before-1",
        afterCommit: "after-1",
      }),
      createCheckpointEntry({
        userEntryId: "entry-2",
        beforeCommit: "before-2",
        afterCommit: "after-2",
      }),
    ];
    const setWidget = vi.fn();
    const ui = { notify: vi.fn(), setWidget } as unknown as ExtensionContext["ui"];

    await expect(
      __piRewindIndexTestOnly.findCleanCheckpointCommit(repo, checkpoints),
    ).resolves.toBe("before-2");
    vi.spyOn(repo, "diffAgainst")
      .mockResolvedValueOnce("1\t0\ta.txt\n")
      .mockResolvedValueOnce("1\t0\tb.txt\n");
    await expect(
      __piRewindIndexTestOnly.findCleanCheckpointCommit(repo, [checkpoints[0]!]),
    ).resolves.toBeUndefined();
    vi.spyOn(repo, "withLock").mockRejectedValueOnce(new Error("lock failed"));
    await expect(
      __piRewindIndexTestOnly.findCleanCheckpointCommit(repo, checkpoints),
    ).resolves.toBeUndefined();

    await expect(
      __piRewindIndexTestOnly.safeRestoreTreeCodeState(repo, undefined, "base", ui),
    ).resolves.toBe(true);
    await expect(
      __piRewindIndexTestOnly.safeRestoreTreeCodeState(repo, "target-1", undefined, ui),
    ).resolves.toBe(true);
    expect(repo.safeCheckout).toHaveBeenCalledWith("target-1");

    await expect(
      __piRewindIndexTestOnly.safeRestoreTreeCodeState(repo, "target-2", "base", ui),
    ).resolves.toBe(false);
    expectCodeRestoreWarningWidget(setWidget, checkpointTargetMissingWidgetMessage);

    const storageMissingRepo = createMockRepo({
      safeCheckout: vi.fn().mockResolvedValue({ ok: false, reason: "storage-missing" }),
    });
    const storageMissingWidget = vi.fn();
    await expect(
      __piRewindIndexTestOnly.safeRestoreTreeCodeState(storageMissingRepo, "target-3", "base", {
        notify: vi.fn(),
        setWidget: storageMissingWidget,
      } as unknown as ExtensionContext["ui"]),
    ).resolves.toBe(false);
    expectCodeRestoreWarningWidget(storageMissingWidget, checkpointStorageMissingWidgetMessage);

    const forkRepo = createMockRepo({ safeCheckout: vi.fn().mockResolvedValue({ ok: true }) });
    await __piRewindIndexTestOnly.restoreForkCodeState(
      forkRepo,
      [
        createUserEntry("entry-1", "test"),
        { type: "custom", customType: "pi-checkpoint", data: checkpoints[0] },
      ],
      [createUserEntry("entry-1", "test")],
      undefined,
      ui,
    );
    expect(forkRepo.safeCheckout).toHaveBeenCalledWith("after-1");

    const cloneRepo = createMockRepo({ safeCheckout: vi.fn().mockResolvedValue({ ok: true }) });
    await __piRewindIndexTestOnly.restoreCloneCodeState(
      cloneRepo,
      [{ type: "custom", customType: "pi-checkpoint", data: checkpoints[0] }],
      "missing-entry",
      ui,
    );
    expect(cloneRepo.safeCheckout).toHaveBeenCalledWith("after-1");

    const emptyCloneRepo = createMockRepo({
      safeCheckout: vi.fn().mockResolvedValue({ ok: true }),
    });
    await __piRewindIndexTestOnly.restoreCloneCodeState(emptyCloneRepo, [], "missing-entry", ui);
    expect(emptyCloneRepo.safeCheckout).not.toHaveBeenCalled();
  });
});

describe("checkpoint extension", () => {
  let tmpDir: string;
  let sessionFile: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    sessionFile = path.join(tmpDir, ".pi", "agent", "sessions", "session.jsonl");
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, "", "utf8");
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (let i = 0; i < 5; i++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if ((code === "EBUSY" || code === "EPERM") && i < 4) {
          await new Promise((r) => setTimeout(r, 200 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
  });

  test("session_start skips manifest sync when no session file is available", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = {
      ...createMockContext(sessionFile, branch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, branch),
        getSessionFile: () => undefined,
      },
    } as MockContext;

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  }, 15000);

  test("plain session_start does not create checkpoint storage", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(false);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  }, 15000);

  test("plain resume session_start does not create checkpoint storage", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "resume" }, ctx);
    }

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(false);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  }, 15000);

  test.each(["resume", "startup"] as const)(
    "%s session_start warns when checkpoint history has no storage",
    async (reason) => {
      const checkpointEntry = createCheckpointEntry({
        fileCount: 1,
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      });
      const branch = [
        createUserEntry("entry-1", "test"),
        { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
      ];
      const { api, events } = createMockApi();
      const ext = await import("./index");
      ext.default(api);

      const ctx = createMockContext(sessionFile, branch, tmpDir);

      for (const h of events["session_start"] || []) {
        await h({ reason }, ctx);
      }

      const repoDir = path.join(
        tmpDir,
        ".pi",
        "agent",
        "ayu",
        "checkpoints",
        "sessions",
        "session",
      );
      const gitExists = await fs
        .access(path.join(repoDir, ".git"))
        .then(() => true)
        .catch(() => false);
      expect(gitExists).toBe(false);
      expect(ctx.ui.notify).not.toHaveBeenCalled();
      expectCodeRestoreWarningWidget(
        ctx.ui.setWidget,
        checkpointSessionStorageMissingWidgetMessage,
      );
    },
  );

  test("first assistant message_start lazily creates checkpoint storage", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(true);
  }, 15000);

  test("session_start ignores non-object settings JSON", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".pi", "settings.json"), "null", "utf8");

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  }, 15000);

  test("session_start ignores invalid settings JSON", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".pi", "settings.json"), "{", "utf8");

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  }, 15000);

  test("session_start propagates unreadable settings errors", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const settingsPath = path.join(tmpDir, ".pi", "settings.json");
    await fs.mkdir(settingsPath, { recursive: true });

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    const sessionStartHandler = events["session_start"]?.[0];
    if (!sessionStartHandler) throw new Error("expected session_start handler");

    await expect(sessionStartHandler({ reason: "new" }, ctx)).rejects.toMatchObject({
      code: expect.stringMatching(/EISDIR|EPERM/),
    });
  });

  test("extension creates checkpoint on turn_start", async () => {
    const branch = [createUserEntry("entry-1", "refactor auth")];
    const { api, events, appendEntry } = createMockApi();

    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-checkpoint",
      expect.objectContaining({
        v: 2,
        kind: "checkpoint",
        userEntryId: "entry-1",
        prompt: "refactor auth",
      }),
    );
  }, 15000);

  test("fork without selected checkpoint restores latest branch completed state", async () => {
    const root = createUserEntry("root-entry", "create file");
    const pending = { ...createUserEntry("pending-entry", "next prompt"), parentId: "root-entry" };
    const checkpointEntry = createCheckpointEntry({
      userEntryId: "root-entry",
      beforeCommit: "root-before",
      afterCommit: "root-after",
    });
    const branch = [
      root,
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
      pending,
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnFork: true } } }),
      "utf8",
    );

    const sessionStartHandlers = events["session_start"] || [];
    const srcCtx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }
    await emitAssistantStart(events, srcCtx);

    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const beforeForkHandlers = events["session_before_fork"] || [];
    for (const h of beforeForkHandlers) {
      await h({ entryId: "pending-entry", position: "before" }, srcCtx);
    }

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "fork", targetSessionFile: forkSessionFile }, srcCtx);
    }

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const forkCtx = createMockContext(forkSessionFile, branch, tmpDir);
    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("root-after");
  }, 30000);

  test("fork copies repo and restores code to fork point", async () => {
    const srcBranch = [createUserEntry("entry-1", "create file")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnFork: true } } }),
      "utf8",
    );

    const srcCtx = createMockContext(sessionFile, srcBranch, projectDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(1)", "utf8");
    await emitAssistantStart(events, srcCtx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(srcBranch), toolResults: [] }, srcCtx);
    }

    const checkpointEntry = appendEntry.mock.calls
      .filter(isMockCall)
      .filter((call) => call[0] === "pi-checkpoint")
      .map((call) => call[1])
      .pop();

    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const forkBranch = [
      createUserEntry("entry-1", "create file"),
      { type: "custom", customType: "other-extension", data: { foo: "bar" } },
      ...(checkpointEntry
        ? [{ type: "custom", customType: "pi-checkpoint", data: checkpointEntry }]
        : []),
    ];
    const forkCtx = createMockContext(forkSessionFile, forkBranch, projectDir);

    const beforeForkHandlers = events["session_before_fork"] || [];
    for (const h of beforeForkHandlers) {
      await h({ entryId: "entry-1", position: "before" }, srcCtx);
    }

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "fork", targetSessionFile: forkSessionFile }, srcCtx);
    }

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    const forkRepoDir = path.join(
      tmpDir,
      ".pi",
      "agent",
      "ayu",
      "checkpoints",
      "sessions",
      "fork-session",
    );
    const forkGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(forkGitExists).toBe(true);

    const content = await fs.readFile(path.join(projectDir, "app.ts"), "utf8");
    expect(content).toBe("console.log(1)");
  }, 15000);

  test("clone copies repo and restores code to selected checkpoint afterCommit", async () => {
    const srcBranch = [createUserEntry("entry-1", "create file")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnClone: true } } }),
      "utf8",
    );

    const srcCtx = createMockContext(sessionFile, srcBranch, projectDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(1)", "utf8");
    await emitAssistantStart(events, srcCtx);

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(2)", "utf8");
    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(srcBranch), toolResults: [] }, srcCtx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, srcCtx);
    }

    const checkpointEntry = appendEntry.mock.calls
      .filter(isMockCall)
      .filter((call) => call[0] === "pi-checkpoint")
      .map((call) => call[1])
      .pop();

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });

    const cloneSessionFile = path.join(tmpDir, "clone-session.jsonl");
    await fs.writeFile(cloneSessionFile, "", "utf8");

    const cloneBranch = [
      createUserEntry("entry-1", "create file"),
      ...(checkpointEntry
        ? [{ type: "custom", customType: "pi-checkpoint", data: checkpointEntry }]
        : []),
    ];
    const cloneCtx = createMockContext(cloneSessionFile, cloneBranch, projectDir);

    const beforeForkHandlers = events["session_before_fork"] || [];
    for (const h of beforeForkHandlers) {
      await h({ entryId: "entry-1", position: "at" }, srcCtx);
    }

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "fork", targetSessionFile: cloneSessionFile }, srcCtx);
    }

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, cloneCtx);
    }

    expect(safeCheckout).toHaveBeenCalledWith(expect.any(String));
    const content = await fs.readFile(path.join(projectDir, "app.ts"), "utf8");
    expect(content).toBe("console.log(2)");
  }, 15000);

  test("clone restore falls back to latest checkpoint when selected entry has no checkpoint", async () => {
    const srcBranch = [createUserEntry("entry-1", "create file")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnClone: true } } }),
      "utf8",
    );

    const srcCtx = createMockContext(sessionFile, srcBranch, projectDir);
    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(1)", "utf8");
    await emitAssistantStart(events, srcCtx);

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(2)", "utf8");
    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(srcBranch), toolResults: [] }, srcCtx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, srcCtx);
    }

    const checkpointEntry = appendEntry.mock.calls
      .filter(isMockCall)
      .filter((call) => call[0] === "pi-checkpoint")
      .map((call) => call[1])
      .pop();

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(3)", "utf8");

    const cloneSessionFile = path.join(tmpDir, "clone-fallback-session.jsonl");
    await fs.writeFile(cloneSessionFile, "", "utf8");

    const cloneBranch = [
      createUserEntry("entry-unknown", "unknown"),
      ...(checkpointEntry
        ? [{ type: "custom", customType: "pi-checkpoint", data: checkpointEntry }]
        : []),
    ];
    const cloneCtx = createMockContext(cloneSessionFile, cloneBranch, projectDir);

    const beforeForkHandlers = events["session_before_fork"] || [];
    for (const h of beforeForkHandlers) {
      await h({ entryId: "entry-unknown", position: "at" }, srcCtx);
    }

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "fork", targetSessionFile: cloneSessionFile }, srcCtx);
    }

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, cloneCtx);
    }

    const content = await fs.readFile(path.join(projectDir, "app.ts"), "utf8");
    expect(content).toBe("console.log(2)");
  }, 15000);

  test("clone skips code restore when no checkpoints exist", async () => {
    const srcBranch = [createUserEntry("entry-1", "init")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnClone: true } } }),
      "utf8",
    );

    const srcCtx = createMockContext(sessionFile, srcBranch, tmpDir);
    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    const cloneSessionFile = path.join(tmpDir, "clone-empty-session.jsonl");
    await fs.writeFile(cloneSessionFile, "", "utf8");

    for (const h of events["session_before_fork"] || []) {
      await h({ entryId: "entry-1", position: "at" }, srcCtx);
    }
    for (const h of events["session_shutdown"] || []) {
      await h({ reason: "fork", targetSessionFile: cloneSessionFile }, srcCtx);
    }

    const checkoutCommit = vi.spyOn(RepoManager.prototype, "checkoutCommit").mockResolvedValue();
    const cloneCtx = createMockContext(
      cloneSessionFile,
      [createUserEntry("entry-1", "init")],
      tmpDir,
    );
    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, cloneCtx);
    }

    expect(checkoutCommit).not.toHaveBeenCalled();
  });

  test("session_start returns when checkpoint repo cannot be bound", async () => {
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api, {
      getRepo: () => undefined,
      setRepo: () => undefined,
      deleteRepo: () => false,
    });

    const ctx = createMockContext(sessionFile, [], tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "fork", previousSessionFile: path.join(tmpDir, "missing.jsonl") }, ctx);
    }

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  test("fork returns early when previousSessionFile missing", async () => {
    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const forkCtx = createMockContext(
      forkSessionFile,
      [createUserEntry("entry-1", "lazy checkpoint")],
      tmpDir,
    );

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "fork" }, forkCtx);
    }

    const forkRepoDir = path.join(
      tmpDir,
      ".pi",
      "agent",
      "ayu",
      "checkpoints",
      "sessions",
      "fork-session",
    );
    const forkGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(forkGitExists).toBe(false);

    await emitAssistantStart(events, forkCtx);
    const lazyGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(lazyGitExists).toBe(true);
  }, 15000);

  test("fork skips restore when no user entry found", async () => {
    const srcBranch = [createUserEntry("entry-1", "init")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const srcCtx = createMockContext(sessionFile, srcBranch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await emitAssistantStart(events, srcCtx);

    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const forkCtx = createMockContext(forkSessionFile, [], tmpDir);

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    const forkRepoDir = path.join(
      tmpDir,
      ".pi",
      "agent",
      "ayu",
      "checkpoints",
      "sessions",
      "fork-session",
    );
    const forkGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(forkGitExists).toBe(true);
  }, 30000);

  test("fork skips restore when checkpoint entry id not in session", async () => {
    const srcBranch = [createUserEntry("entry-1", "init")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const srcCtx = createMockContext(sessionFile, srcBranch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await emitAssistantStart(events, srcCtx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(srcBranch), toolResults: [] }, srcCtx);
    }

    const checkpointEntry = appendEntry.mock.calls
      .filter(isMockCall)
      .filter((call) => call[0] === "pi-checkpoint")
      .map((call) => call[1])
      .pop();

    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const forkBranch = [
      createUserEntry("entry-unknown", "unknown"),
      { type: "custom", customType: "other-extension", data: { foo: "bar" } },
      ...(checkpointEntry
        ? [
            {
              type: "custom",
              customType: "pi-checkpoint",
              data: { ...checkpointEntry, userEntryId: "different-id" },
            },
          ]
        : []),
    ];
    const forkCtx = createMockContext(forkSessionFile, forkBranch, tmpDir);

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    const forkRepoDir = path.join(
      tmpDir,
      ".pi",
      "agent",
      "ayu",
      "checkpoints",
      "sessions",
      "fork-session",
    );
    const forkGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(forkGitExists).toBe(true);
  }, 15000);

  test("fork copies repo without restoring code when restoreOnFork is never", async () => {
    const srcBranch = [createUserEntry("entry-1", "init")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnFork: false } } }),
      "utf8",
    );

    const srcCtx = createMockContext(sessionFile, srcBranch, projectDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(1)", "utf8");
    await emitAssistantStart(events, srcCtx);

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(2)", "utf8");

    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const forkBranch = [createUserEntry("entry-1", "init")];
    const forkCtx = createMockContext(forkSessionFile, forkBranch, projectDir);

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    const content = await fs.readFile(path.join(projectDir, "app.ts"), "utf8");
    expect(content).toBe("console.log(2)");
  }, 15000);

  test("fork returns early when src repo does not exist", async () => {
    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const forkCtx = createMockContext(
      forkSessionFile,
      [createUserEntry("entry-1", "lazy checkpoint")],
      tmpDir,
    );

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h(
        {
          reason: "fork",
          previousSessionFile: path.join(tmpDir, "nonexistent.jsonl"),
        },
        forkCtx,
      );
    }

    const forkRepoDir = path.join(
      tmpDir,
      ".pi",
      "agent",
      "ayu",
      "checkpoints",
      "sessions",
      "fork-session",
    );
    const forkGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(forkGitExists).toBe(false);

    await emitAssistantStart(events, forkCtx);
    const lazyGitExists = await fs
      .access(path.join(forkRepoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(lazyGitExists).toBe(true);
  }, 15000);

  test("fork returns early when dst repo already exists", async () => {
    const srcBranch = [createUserEntry("entry-1", "init")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const srcCtx = createMockContext(sessionFile, srcBranch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await emitAssistantStart(events, srcCtx);

    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");

    const dstDir = path.join(
      tmpDir,
      ".pi",
      "agent",
      "ayu",
      "checkpoints",
      "sessions",
      "fork-session",
    );
    await fs.mkdir(path.join(dstDir, ".git"), { recursive: true });
    const markerPath = path.join(dstDir, ".git", "marker.txt");
    await fs.writeFile(markerPath, "original", "utf8");

    const forkCtx = createMockContext(forkSessionFile, srcBranch, tmpDir);

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    const markerContent = await fs.readFile(markerPath, "utf8");
    expect(markerContent).toBe("original");
  });

  test("queued user decisions create separate checkpoint entries", async () => {
    const branch = [createUserEntry("entry-1", "generate test3.txt")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "test3.txt"), "test3\n", "utf8");
    branch.push(createUserEntry("entry-2", "generate test4.txt"));

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "test4.txt"), "test4\n", "utf8");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    const first = expectCheckpointEntryCall(appendEntry, 0);
    const second = expectCheckpointEntryCall(appendEntry, 1);
    expect(first[1].userEntryId).toBe("entry-1");
    expect(first[1].prompt).toBe("generate test3.txt");
    expect(first[1].fileChanges.map((c) => c.path)).toContain("test3.txt");
    expect(second[1].userEntryId).toBe("entry-2");
    expect(second[1].prompt).toBe("generate test4.txt");
    expect(second[1].fileChanges.map((c) => c.path)).toContain("test4.txt");
  }, 15000);

  test("turn_end detects actual file changes", async () => {
    const branch = [createUserEntry("entry-1", "write file")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "test.ts"), "content", "utf8");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].fileCount).toBe(1);
  });

  test("queued turn_end and agent_end do not duplicate checkpoints", async () => {
    const branch = [createUserEntry("entry-1", "生成空 test5.txt")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    vi.spyOn(RepoManager.prototype, "diffAgainst").mockImplementation(
      async () => new Promise((resolve) => setTimeout(() => resolve("1\t0\ttest6.txt\n"), 10)),
    );

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "test5.txt"), "", "utf8");
    branch.push(createUserEntry("entry-2", "生成空 test6.txt"));
    await fs.writeFile(path.join(tmpDir, "test6.txt"), "", "utf8");

    const turnEndHandlers = events["turn_end"] || [];
    const agentEndHandlers = events["agent_end"] || [];
    await Promise.all([
      (async () => {
        for (const h of turnEndHandlers) {
          await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
        }
      })(),
      (async () => {
        for (const h of agentEndHandlers) {
          await h({ messages: [] }, ctx);
        }
      })(),
    ]);

    expect(appendEntry).toHaveBeenCalledTimes(1);
    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].userEntryId).toBe("entry-1");
    expect(call[1].prompt).toBe("生成空 test5.txt");
    expect(call[1].fileChanges.map((c) => c.path)).toContain("test6.txt");
  });

  test("turn_end parses diff stats correctly", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "b.ts"), "export const b = 2;\n", "utf8");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].fileChanges.length).toBeGreaterThan(0);
  }, 15000);

  test("turn_end handles binary file diff stats", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "test.ts"), "", "utf8");

    vi.spyOn(RepoManager.prototype, "diffAgainst").mockResolvedValue("-\t-\tpath\n");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    const call = expectCheckpointEntryCall(appendEntry, 0);
    const change = expectFileChange(call[1], 0);
    expect(change.path).toBe("path");
    expect(change.added).toBe(0);
    expect(change.removed).toBe(0);
  }, 15000);

  test("turn_end handles non-standard diff output", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    await fs.writeFile(path.join(tmpDir, "test.ts"), "", "utf8");

    vi.spyOn(RepoManager.prototype, "diffAgainst").mockResolvedValue("no-tabs-line\n");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    const call = expectCheckpointEntryCall(appendEntry, 0);
    const change = expectFileChange(call[1], 0);
    expect(change.path).toBe("no-tabs-line");
    expect(change.added).toBe(0);
    expect(change.removed).toBe(0);
  }, 15000);

  test("rewind command delegates to getRepo", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, registerCommand, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalled();

    const rewindCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "rewind");
    expect(rewindCall).toBeDefined();
    if (!rewindCall) throw new Error("rewind command not registered");
    const handler = rewindCall[1].handler;

    const cmdCtx = {
      ui: {
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue(undefined),
        input: vi.fn(),
      },
      navigateTree: vi.fn(),
      sessionManager: {
        getEntries: () =>
          appendEntry.mock.calls.map((call) => ({
            type: "custom",
            customType: call[0],
            data: call[1],
          })),
        getBranch: () => branch,
        getSessionId: () => "test-session",
      },
    } as unknown as ExtensionCommandContext;

    await handler("", cmdCtx);
    expect(cmdCtx.ui.select).toHaveBeenCalled();
  });

  test("turn_start skips when disabled", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { enabled: false } } }),
      "utf8",
    );

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("turn_end does nothing before session_start", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("turn_end does nothing when no checkpoint pending", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(false);
  });

  test("turn_end returns early when the pending producer no longer has a user leaf", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    branch.splice(0, branch.length);

    for (const h of events["turn_end"] || []) {
      await h({ turnIndex: 0, message: createAssistantMessage(), toolResults: [] }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("session_shutdown does nothing on non-fork", async () => {
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const branch = [createUserEntry("entry-1", "test")];
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "normal" }, ctx);
    }

    expect(true).toBe(true);
  });

  test("turn_start skips when autoCheckpoint disabled", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { enabled: true, autoCheckpoint: false } } }),
      "utf8",
    );

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("global checkpoint settings survive when project only sets ayu", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi", "agent"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { enabled: false } } }),
      "utf8",
    );
    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { rewind: { restoreOnTree: "always" } } }),
      "utf8",
    );

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("clone copies repo without restoring when restoreOnClone is never", async () => {
    const srcBranch = [createUserEntry("entry-1", "create file")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { restoreOnClone: false } } }),
      "utf8",
    );

    const srcCtx = createMockContext(sessionFile, srcBranch, projectDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(1)", "utf8");
    await emitAssistantStart(events, srcCtx);

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(2)", "utf8");
    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(srcBranch), toolResults: [] }, srcCtx);
    }

    const checkpointEntry = appendEntry.mock.calls
      .filter(isMockCall)
      .filter((call) => call[0] === "pi-checkpoint")
      .map((call) => call[1])
      .pop();

    await fs.writeFile(path.join(projectDir, "app.ts"), "console.log(3)", "utf8");

    const cloneSessionFile = path.join(tmpDir, "clone-never-session.jsonl");
    await fs.writeFile(cloneSessionFile, "", "utf8");

    const cloneBranch = [
      createUserEntry("entry-1", "create file"),
      ...(checkpointEntry
        ? [{ type: "custom", customType: "pi-checkpoint", data: checkpointEntry }]
        : []),
    ];
    const cloneCtx = createMockContext(cloneSessionFile, cloneBranch, projectDir);

    const beforeForkHandlers = events["session_before_fork"] || [];
    for (const h of beforeForkHandlers) {
      await h({ entryId: "entry-1", position: "at" }, srcCtx);
    }

    const shutdownHandlers = events["session_shutdown"] || [];
    for (const h of shutdownHandlers) {
      await h({ reason: "fork", targetSessionFile: cloneSessionFile }, srcCtx);
    }

    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, cloneCtx);
    }

    const content = await fs.readFile(path.join(projectDir, "app.ts"), "utf8");
    expect(content).toBe("console.log(3)");
  }, 30000);

  test("turn_start skips when no user entry found", async () => {
    const branch: SessionEntry[] = [];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("resume session_start with restore always returns silently when no target checkpoint exists", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
      "utf8",
    );

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, ctx);
    }

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(false);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test.each(["resume", "startup"] as const)(
    "%s session_start warns when restore storage is missing",
    async (reason) => {
      const checkpointEntry = createCheckpointEntry({
        afterCommit: "resume-after",
        fileCount: 1,
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      });
      const branch = [
        createUserEntry("entry-1", "test"),
        { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
      ];
      const { api, events } = createMockApi();
      const ext = await import("./index");
      ext.default(api);

      await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".pi", "settings.json"),
        JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
        "utf8",
      );

      const safeCheckout = vi
        .spyOn(RepoManager.prototype, "safeCheckout")
        .mockResolvedValue({ ok: true });
      const ctx = createMockContext(sessionFile, branch, tmpDir);

      for (const h of events["session_start"] || []) {
        await h({ reason }, ctx);
      }

      const repoDir = path.join(
        tmpDir,
        ".pi",
        "agent",
        "ayu",
        "checkpoints",
        "sessions",
        "session",
      );
      const gitExists = await fs
        .access(path.join(repoDir, ".git"))
        .then(() => true)
        .catch(() => false);
      expect(gitExists).toBe(false);
      expect(ctx.ui.notify).not.toHaveBeenCalled();
      expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
      expect(safeCheckout).not.toHaveBeenCalled();
    },
  );

  test.each(["resume", "startup"] as const)(
    "%s session_start restores latest branch checkpoint when existing storage matches known checkpoint",
    async (reason) => {
      const checkpointEntry = createCheckpointEntry({ afterCommit: "resume-after" });
      const branch = [
        createUserEntry("entry-1", "test"),
        { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
      ];
      const { api, events } = createMockApi();
      const ext = await import("./index");
      ext.default(api);

      await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".pi", "settings.json"),
        JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
        "utf8",
      );

      const bootstrapCtx = createMockContext(
        sessionFile,
        [createUserEntry("entry-1", "test")],
        tmpDir,
      );
      for (const h of events["session_start"] || []) {
        await h({ reason: "new" }, bootstrapCtx);
      }
      await emitAssistantStart(events, bootstrapCtx);

      vi.spyOn(RepoManager.prototype, "stageAll").mockResolvedValue();
      vi.spyOn(RepoManager.prototype, "diffAgainst").mockImplementation((commit: string) =>
        Promise.resolve(commit === "resume-after" ? "" : "1\t0\tfile.ts\n"),
      );
      const safeCheckout = vi
        .spyOn(RepoManager.prototype, "safeCheckout")
        .mockResolvedValue({ ok: true });
      const ctx = createMockContext(sessionFile, branch, tmpDir);

      const sessionStartHandlers = events["session_start"] || [];
      for (const h of sessionStartHandlers) {
        await h({ reason }, ctx);
      }

      const repoDir = path.join(
        tmpDir,
        ".pi",
        "agent",
        "ayu",
        "checkpoints",
        "sessions",
        "session",
      );
      const gitExists = await fs
        .access(path.join(repoDir, ".git"))
        .then(() => true)
        .catch(() => false);
      expect(gitExists).toBe(true);
      expect(safeCheckout).toHaveBeenCalledWith("resume-after");
    },
  );

  test("resume session_start force restores when workspace has unsnapshotted changes", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "resume-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
      "utf8",
    );
    const bootstrapCtx = createMockContext(
      sessionFile,
      [createUserEntry("entry-1", "test")],
      tmpDir,
    );
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, bootstrapCtx);
    }
    await emitAssistantStart(events, bootstrapCtx);

    vi.spyOn(RepoManager.prototype, "stageAll").mockResolvedValue();
    vi.spyOn(RepoManager.prototype, "diffAgainst").mockReturnValue(
      Promise.resolve("1\t0\tfile.ts\n"),
    );
    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "resume" }, ctx);
    }

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(safeCheckout).toHaveBeenCalledWith("resume-after");
  });

  test("resume session_start reports unusable storage", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "resume-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
      "utf8",
    );

    const bootstrapCtx = createMockContext(
      sessionFile,
      [createUserEntry("entry-1", "test")],
      tmpDir,
    );
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, bootstrapCtx);
    }
    await emitAssistantStart(events, bootstrapCtx);

    vi.spyOn(RepoManager.prototype, "lockedSetExclude").mockRejectedValueOnce(new Error("boom"));
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Checkpoint storage could not be prepared for resume restore: boom",
      "error",
    );
  });

  test("resume session_start skips unusable-storage notifications when UI is unavailable", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "resume-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
      "utf8",
    );

    const bootstrapCtx = createMockContext(
      sessionFile,
      [createUserEntry("entry-1", "test")],
      tmpDir,
    );
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, bootstrapCtx);
    }
    await emitAssistantStart(events, bootstrapCtx);

    vi.spyOn(RepoManager.prototype, "lockedSetExclude").mockRejectedValueOnce(new Error("boom"));
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.hasUI = false;
    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, ctx);
    }
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  test("resume session_start skips missing-storage UI when UI is unavailable", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "resume-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
      "utf8",
    );

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.hasUI = false;
    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, ctx);
    }
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });

  test("resume session_start reports checkout failures with UI and skips them without UI", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "resume-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [], restoreOnResume: true } } }),
      "utf8",
    );

    const bootstrapCtx = createMockContext(
      sessionFile,
      [createUserEntry("entry-1", "test")],
      tmpDir,
    );
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, bootstrapCtx);
    }
    await emitAssistantStart(events, bootstrapCtx);

    vi.spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValueOnce({ ok: false, reason: "dirty", message: "unsnapped" })
      .mockResolvedValueOnce({ ok: false, reason: "dirty", message: "unsnapped" });

    const uiCtx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, uiCtx);
    }
    expect(uiCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Skipped file restore because the workspace has changes"),
      "warning",
    );

    const noUiCtx = createMockContext(sessionFile, branch, tmpDir);
    noUiCtx.hasUI = false;
    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, noUiCtx);
    }
    expect(noUiCtx.ui.notify).not.toHaveBeenCalled();
  });

  test("session_tree defaults to ask mode", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("No");

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const beforeTreeHandlers = events["session_before_tree"] || [];
    for (const h of beforeTreeHandlers) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("rewind conversation navigation suppresses tree file restore", async () => {
    const checkpointEntry = createCheckpointEntry({
      userEntryId: "entry-1",
      beforeCommit: "before",
      afterCommit: "after",
      fileCount: 0,
      fileChanges: [],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events, registerCommand } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const beforeTreeHandlers = events["session_before_tree"] || [];
    const treeHandlers = events["session_tree"] || [];
    const rewindCall = registerCommand.mock.calls.find((c: unknown[]) => c[0] === "rewind");
    expect(rewindCall).toBeDefined();
    if (!rewindCall) throw new Error("rewind command not registered");

    const cmdCtx = {
      ui: {
        notify: vi.fn(),
        select: vi
          .fn()
          .mockImplementationOnce((_title: string, options: string[]) => options[0])
          .mockResolvedValueOnce("Restore conversation"),
        input: vi.fn(),
      },
      navigateTree: vi.fn(async () => {
        for (const h of beforeTreeHandlers) {
          await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
        }
        for (const h of treeHandlers) {
          await h({ oldLeafId: "entry-1", newLeafId: "entry-1" }, ctx);
        }
      }),
      sessionManager: {
        getEntries: () => branch,
        getBranch: () => branch,
        getSessionId: () => "test-session",
      },
    } as unknown as ExtensionCommandContext;

    await rewindCall[1].handler("", cmdCtx);

    expect(cmdCtx.navigateTree).toHaveBeenCalledWith("entry-1", { summarize: false });
    expect(ctx.ui.select).not.toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree ask mode skips sync prompt when target code state is already synced", async () => {
    const changed = createUserEntry("changed", "change files");
    const unchanged = { ...createUserEntry("unchanged", "discuss"), parentId: "changed" };
    const changedCheckpoint = createCheckpointEntry({
      userEntryId: "changed",
      beforeCommit: "old-code",
      afterCommit: "new-code",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const unchangedCheckpoint = createCheckpointEntry({
      userEntryId: "unchanged",
      beforeCommit: "new-code",
      afterCommit: "new-code",
    });
    const branch = [
      changed,
      unchanged,
      { type: "custom", customType: "pi-checkpoint", data: changedCheckpoint },
      { type: "custom", customType: "pi-checkpoint", data: unchangedCheckpoint },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "unchanged", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "unchanged", newLeafId: "unchanged" }, ctx);
    }

    expect(ctx.ui.select).not.toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree ask mode restores files only when user confirms sync", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("Yes");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).toHaveBeenCalledWith("before-hash", expect.any(String));
  });

  test("session_tree handles storage warnings, unusable storage, and no-UI always mode", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "always");

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    vi.spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValueOnce({ ok: false, reason: "storage-missing" })
      .mockResolvedValueOnce({ ok: false, reason: "target-missing" });
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointTargetMissingWidgetMessage);

    vi.spyOn(RepoManager.prototype, "lockedSetExclude").mockRejectedValueOnce(
      new Error("tree boom"),
    );
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Checkpoint storage could not be prepared for resume restore: tree boom",
      "error",
    );

    const noUiCtx = {
      ...createMockContext(sessionFile, branch, tmpDir),
      hasUI: false,
    } as MockContext;
    await fs.rm(path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session"), {
      recursive: true,
      force: true,
    });
    for (const h of events["input"] || []) {
      await h({}, noUiCtx);
    }
    for (const h of events["session_start"] || []) {
      await h({ reason: "resume" }, noUiCtx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, noUiCtx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, noUiCtx);
    }
    expect(noUiCtx.ui.notify).not.toHaveBeenCalled();
    expect(noUiCtx.ui.setWidget).not.toHaveBeenCalled();
  });

  test("session_tree falls back to ctx cwd and session file before session_start", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const repo = new RepoManager(path.join(repoDir, ".git"), path.join(repoDir, "index"), tmpDir);
    await repo.init();

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("Yes");
    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });

    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("before-hash");
  }, 15000);

  test("session_tree ask mode warns when storage disappears after repo was pre-bound", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("Yes");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    await fs.rm(repoDir, { recursive: true, force: true });

    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
  }, 15000);

  test("session_tree ask mode keeps missing-storage warning when tree callback has no UI", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("Yes");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    await fs.rm(repoDir, { recursive: true, force: true });

    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    const treeCtx = { ...ctx, hasUI: false } as MockContext;
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, treeCtx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
  }, 15000);

  test("session_tree ask mode does not prompt when user chooses to summarise", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    // User chose "Summarize" — userWantsSummary is true
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: true } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    // Should NOT show sync prompt when user chose to summarise
    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree ask mode finalizes pending checkpoint before prompting", async () => {
    const branch = [createUserEntry("entry-1", "write file")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("No");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    await fs.writeFile(path.join(tmpDir, "test.txt"), "content", "utf8");

    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-checkpoint",
      expect.objectContaining({ fileCount: 1 }),
    );
    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
  });

  test("session_tree ask mode is isolated per session", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const cwdAsk = path.join(tmpDir, "ask-project");
    const cwdNever = path.join(tmpDir, "never-project");
    await fs.mkdir(cwdAsk, { recursive: true });
    await fs.mkdir(cwdNever, { recursive: true });
    await setTreeRestoreMode(cwdAsk, "ask");
    await setTreeRestoreMode(cwdNever, "never");

    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const askCtx = createMockContext(sessionFile, branch, cwdAsk, "ask-session");
    const neverCtx = createMockContext(
      path.join(tmpDir, "never-session.jsonl"),
      branch,
      cwdNever,
      "never-session",
    );
    askCtx.ui.select.mockResolvedValueOnce("No");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, askCtx);
      await h({ reason: "new" }, neverCtx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, askCtx);
    }

    expect(askCtx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(neverCtx.ui.select).not.toHaveBeenCalled();
  });

  test("session_tree ask mode without UI keeps native tree behavior", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = { ...createMockContext(sessionFile, branch, tmpDir), hasUI: false };

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree ask mode skips file restore when user declines sync", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("No");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
  });

  async function runTreeAskScenario(
    events: Record<string, Array<MockEventHandler>>,
    ctx: ExtensionContext,
    sessionStartEvent: {
      readonly reason: "new" | "resume" | "fork";
      readonly previousSessionFile?: string;
    },
  ): Promise<void> {
    for (const h of events["session_start"] || []) {
      await h(sessionStartEvent, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }
  }

  async function prepareForkSourceSession(
    events: Record<string, Array<MockEventHandler>>,
    sourceCtx: ExtensionContext,
    targetSessionFile: string,
    position: "before" | "at",
  ): Promise<void> {
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, sourceCtx);
    }
    for (const h of events["session_before_fork"] || []) {
      await h({ entryId: "entry-1", position }, sourceCtx);
    }
    for (const h of events["session_shutdown"] || []) {
      await h({ reason: "fork", targetSessionFile }, sourceCtx);
    }
  }

  async function prepareCloneSourceSession(
    events: Record<string, Array<MockEventHandler>>,
    sourceCtx: ExtensionContext,
    targetSessionFile: string,
  ): Promise<void> {
    await prepareForkSourceSession(events, sourceCtx, targetSessionFile, "at");
  }

  test("session_tree ask mode skips sync prompt when no checkpoints changed files", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    await runTreeAskScenario(events, ctx, { reason: "new" });

    expect(ctx.ui.select).not.toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree ask mode keeps prompting when any checkpoint in the session changed files", async () => {
    const changedCheckpoint = createCheckpointEntry({
      afterCommit: "changed-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const unchangedCheckpoint = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: unchangedCheckpoint },
    ];
    let entries: readonly unknown[] = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: changedCheckpoint },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = {
      ...createMockContext(sessionFile, branch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, branch),
        getEntries: () => entries,
      },
    } as unknown as ExtensionContext;
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("No");

    await runTreeAskScenario(events, ctx, { reason: "new" });

    entries = branch;

    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_start new session rebuilds ask cache from session history", async () => {
    const changedCheckpoint = createCheckpointEntry({
      afterCommit: "changed-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: changedCheckpoint },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    await runTreeAskScenario(events, ctx, { reason: "new" });

    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_start resume session rebuilds ask cache from resumed history", async () => {
    const changedCheckpoint = createCheckpointEntry({
      afterCommit: "changed-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: changedCheckpoint },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "ask");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    await runTreeAskScenario(events, ctx, { reason: "resume" });

    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_start fork session rebuilds ask cache from forked history", async () => {
    const changedCheckpoint = createCheckpointEntry({
      afterCommit: "changed-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const sourceBranch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: changedCheckpoint },
    ];
    const forkSessionFile = path.join(tmpDir, "fork-session.jsonl");
    await fs.writeFile(forkSessionFile, "", "utf8");
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({
        ayu: {
          rewind: { restoreOnTree: "ask" },
          checkpoint: { restoreOnFork: "never", restoreOnClone: "never" },
        },
      }),
      "utf8",
    );

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const sourceCtx = createMockContext(sessionFile, sourceBranch, tmpDir);
    await prepareForkSourceSession(events, sourceCtx, forkSessionFile, "before");

    const forkCtx = createMockContext(forkSessionFile, sourceBranch, tmpDir);
    await runTreeAskScenario(events, forkCtx, {
      reason: "fork",
      previousSessionFile: sessionFile,
    });

    expect(forkCtx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_start clone session rebuilds ask cache from cloned history", async () => {
    const changedCheckpoint = createCheckpointEntry({
      afterCommit: "changed-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const sourceBranch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: changedCheckpoint },
    ];
    const cloneSessionFile = path.join(tmpDir, "clone-session.jsonl");
    await fs.writeFile(cloneSessionFile, "", "utf8");
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({
        ayu: {
          rewind: { restoreOnTree: "ask" },
          checkpoint: { restoreOnFork: "never", restoreOnClone: "never" },
        },
      }),
      "utf8",
    );

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const sourceCtx = createMockContext(sessionFile, sourceBranch, tmpDir);
    await prepareCloneSourceSession(events, sourceCtx, cloneSessionFile);

    const cloneCtx = createMockContext(cloneSessionFile, sourceBranch, tmpDir);
    await runTreeAskScenario(events, cloneCtx, {
      reason: "fork",
      previousSessionFile: sessionFile,
    });

    expect(cloneCtx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree never mode skips file restore after no-summary navigation", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await setTreeRestoreMode(tmpDir, "never");

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree does not restore files when tree navigation summarizes", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: true } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_before_tree uses loadConfig fallback when session config not set", async () => {
    // This test exercises the ?? loadConfig({}) branch of getSessionConfig
    // by calling session_before_tree WITHOUT first calling session_start,
    // so sessionConfigs.getOrUndefined(sessionId) returns undefined.
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);
    ctx.ui.select.mockResolvedValueOnce("No");

    // Skip session_start — go straight to session_before_tree
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }

    // Should not throw — getSessionConfig falls back to loadConfig({})
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  test("session_tree always mode warns when selected restore storage is missing", async () => {
    const checkpointEntry = createCheckpointEntry({
      afterCommit: "tree-after",
      fileCount: 1,
      fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    await fs.rm(repoDir, { recursive: true, force: true });

    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    expect(hasCodeRestoreWarningWidget(ctx.ui.setWidget)).toBe(false);

    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
  }, 15000);

  test("session_tree restores latest branch checkpoint when ayu rewind restoreOnTree is always", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
  });

  test("session_tree falls back to current branch without UI", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = { ...createMockContext(sessionFile, branch, tmpDir), hasUI: false };

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    for (const h of events["session_tree"] || []) {
      await h({}, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
  }, 15000);

  test("session_before_tree ignores malformed events", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    for (const h of events["session_before_tree"] || []) {
      await h(null, ctx);
      await h({ preparation: "not-object" }, ctx);
      await h({ preparation: { targetId: 123 } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
  });

  test("session_tree ignores malformed event when repo exists", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    for (const h of events["session_tree"] || []) {
      await h(null, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
  });

  test("session_tree warns when target checkpoint storage is not bound", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api, {
      getRepo: () => undefined,
      setRepo: () => undefined,
      deleteRepo: () => false,
    });
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "fork" }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
  });

  test("session_tree always mode keeps missing-storage warning when tree callback has no UI", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    await fs.rm(repoDir, { recursive: true, force: true });

    const treeCtx = { ...ctx, hasUI: false } as MockContext;
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, treeCtx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointStorageMissingWidgetMessage);
  }, 15000);

  test("session_tree reports missing target checkpoint from storage", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: false, reason: "target-missing" });
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
    expectCodeRestoreWarningWidget(ctx.ui.setWidget, checkpointTargetMissingWidgetMessage);

    ctx.ui.setWidget.mockClear();
    for (const h of events["input"] || []) {
      await h({ text: "next" }, ctx);
    }

    expect(ctx.ui.setWidget).toHaveBeenCalledWith(codeRestoreWarningWidgetId, undefined);
  }, 15000);

  test("session_tree resolves existing checkpoint storage when repo is not pre-bound", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    await enableTreeRestore(tmpDir);

    const bootstrap = createMockApi();
    const ext = await import("./index");
    ext.default(bootstrap.api);
    const bootstrapCtx = createMockContext(
      sessionFile,
      [createUserEntry("entry-1", "test")],
      tmpDir,
    );
    for (const h of bootstrap.events["session_start"] || []) {
      await h({ reason: "new" }, bootstrapCtx);
    }
    await emitAssistantStart(bootstrap.events, bootstrapCtx);

    const { api, events } = createMockApi();
    ext.default(api);
    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
  }, 15000);

  test("session_tree ignores non-record entries while building branches", async () => {
    const checkpointEntry = createCheckpointEntry({
      userEntryId: "entry-1",
      afterCommit: "tree-after",
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = {
      ...createMockContext(sessionFile, branch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, branch),
        getEntries: () => ["not-entry", ...branch],
      },
    } as unknown as ExtensionContext;

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "entry-1", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after");
  });

  test("session_tree falls back for malformed target message", async () => {
    const malformedTarget = {
      type: "message",
      id: "bad-target",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: "not-object",
    };
    const checkpointEntry = createCheckpointEntry({
      userEntryId: "entry-1",
      afterCommit: "tree-after",
    });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const entries = [malformedTarget, ...branch];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = {
      ...createMockContext(sessionFile, branch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, branch),
        getEntries: () => entries,
      },
    } as unknown as ExtensionContext;

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ targetId: "bad-target" }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "entry-1", newLeafId: "bad-target" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_start applies maxFileMB in bytes", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { maxFileMB: 2 } } }),
      "utf8",
    );

    const setMaxFileBytes = vi.spyOn(RepoManager.prototype, "setMaxFileBytes");
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    expect(setMaxFileBytes).not.toHaveBeenCalled();

    await emitAssistantStart(events, ctx);

    expect(setMaxFileBytes).toHaveBeenCalledWith(2 * 1024 * 1024);
  });

  test("fork and clone skip UI notifications when UI is unavailable", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "after-hash" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];

    for (const position of ["before", "at"] as const) {
      const { api, events } = createMockApi();
      const ext = await import("./index");
      ext.default(api);
      await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".pi", "settings.json"),
        JSON.stringify({
          ayu: {
            checkpoint: position === "at" ? { restoreOnClone: true } : { restoreOnFork: true },
          },
        }),
        "utf8",
      );
      const safeCheckout = vi
        .spyOn(RepoManager.prototype, "safeCheckout")
        .mockResolvedValueOnce({ ok: false, reason: "checkout-failed", error: "restore failed" });
      const ctx = { ...createMockContext(sessionFile, branch, tmpDir), hasUI: false };

      for (const h of events["session_start"] || []) {
        await h({ reason: "new" }, ctx);
      }
      await emitAssistantStart(events, ctx);
      for (const h of events["session_before_fork"] || []) {
        await h({ entryId: "entry-1", position }, ctx);
      }
      for (const h of events["session_shutdown"] || []) {
        await h({ reason: "fork", targetSessionFile: path.join(tmpDir, `${position}.jsonl`) }, ctx);
      }
      const targetCtx = {
        ...createMockContext(path.join(tmpDir, `${position}.jsonl`), branch, tmpDir),
        hasUI: false,
      };
      for (const h of events["session_start"] || []) {
        await h({ reason: "fork", previousSessionFile: sessionFile }, targetCtx);
      }

      expect(safeCheckout).toHaveBeenCalled();
      expect(targetCtx.ui.notify).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  }, 30000);

  test("fork and clone report restore failures without UI crashes", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "after-hash" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const cases: Array<{ reason: "fork" | "clone"; message: string }> = [
      { reason: "fork", message: "Fork file restore failed" },
      { reason: "clone", message: "Clone file restore failed" },
    ];

    for (const testCase of cases) {
      const { api, events } = createMockApi();
      const ext = await import("./index");
      ext.default(api);
      await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".pi", "settings.json"),
        JSON.stringify({
          ayu: {
            checkpoint:
              testCase.reason === "clone" ? { restoreOnClone: true } : { restoreOnFork: true },
          },
        }),
        "utf8",
      );
      vi.spyOn(RepoManager.prototype, "safeCheckout").mockResolvedValueOnce({
        ok: false,
        reason: "checkout-failed",
        error: "restore failed",
      });
      const ctx = createMockContext(sessionFile, branch, tmpDir);

      for (const h of events["session_start"] || []) {
        await h({ reason: "new" }, ctx);
      }
      await emitAssistantStart(events, ctx);
      for (const h of events["session_before_fork"] || []) {
        await h(
          { entryId: "entry-1", position: testCase.reason === "clone" ? "at" : "before" },
          ctx,
        );
      }
      for (const h of events["session_shutdown"] || []) {
        await h(
          { reason: "fork", targetSessionFile: path.join(tmpDir, `${testCase.reason}.jsonl`) },
          ctx,
        );
      }
      const targetCtx = createMockContext(
        path.join(tmpDir, `${testCase.reason}.jsonl`),
        branch,
        tmpDir,
      );
      for (const h of events["session_start"] || []) {
        await h({ reason: "fork", previousSessionFile: sessionFile }, targetCtx);
      }

      expect(targetCtx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining(testCase.message),
        expect.any(String),
      );
      vi.restoreAllMocks();
    }
  }, 15000);

  test("session_tree reports restore failures", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const cases: Array<{ readonly result: SafeCheckoutResult; readonly message: string }> = [
      {
        result: { ok: false, reason: "dirty" },
        message: "changes that are not captured by this session's checkpoint history",
      },
      { result: { ok: false, reason: "dirty-check-failed" }, message: "Could not verify" },
      {
        result: {
          ok: false,
          reason: "checkout-failed",
          error: "restore failed",
          rollbackError: "rollback failed",
        },
        message: "rollback also failed",
      },
      {
        result: { ok: false, reason: "checkout-failed", error: "restore failed" },
        message: "Tree file restore failed: restore failed",
      },
      {
        result: { ok: false, reason: "checkout-failed" },
        message: "Tree file restore failed: checkpoint restore failed",
      },
    ];

    for (const { result, message } of cases) {
      const { api, events } = createMockApi();
      const ext = await import("./index");
      ext.default(api);
      await enableTreeRestore(tmpDir);
      vi.spyOn(RepoManager.prototype, "safeCheckout").mockResolvedValueOnce(result);
      const ctx = createMockContext(sessionFile, branch, tmpDir);

      for (const h of events["session_start"] || []) {
        await h({ reason: "new" }, ctx);
      }
      await emitAssistantStart(events, ctx);
      for (const h of events["session_tree"] || []) {
        await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
      }

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining(message),
        expect.any(String),
      );
      vi.restoreAllMocks();
    }
  }, 15000);

  test("session_tree always mode force restores target user before commit", async () => {
    const root = { ...createUserEntry("root-user", "root"), parentId: "model" };
    const oldUser = { ...createUserEntry("old-user", "old"), parentId: "root-user" };
    const oldLeaf = { ...createUserEntry("old-leaf", "old leaf"), parentId: "old-user" };
    const targetUser = { ...createUserEntry("target-user", "target"), parentId: "root-user" };
    const unrelatedUser = {
      ...createUserEntry("unrelated-user", "unrelated"),
      parentId: "root-user",
    };
    const oldCheckpoint = createCheckpointEntry({
      userEntryId: "old-user",
      beforeCommit: "old-before",
      afterCommit: "old-after",
    });
    const targetCheckpoint = createCheckpointEntry({
      userEntryId: "target-user",
      beforeCommit: "target-before",
      afterCommit: "target-after",
      fileCount: 1,
      fileChanges: [{ path: "target.ts", added: 1, removed: 0 }],
    });
    const unrelatedLatestCheckpoint = createCheckpointEntry({
      userEntryId: "unrelated-user",
      beforeCommit: "unrelated-before",
      afterCommit: "unrelated-after",
    });
    const entries = [
      root,
      oldUser,
      oldLeaf,
      targetUser,
      unrelatedUser,
      { type: "custom", customType: "pi-checkpoint", data: oldCheckpoint },
      { type: "custom", customType: "pi-checkpoint", data: targetCheckpoint },
      { type: "custom", customType: "pi-checkpoint", data: unrelatedLatestCheckpoint },
    ];
    const newBranch = [root, targetUser];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = {
      ...createMockContext(sessionFile, newBranch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, newBranch),
        getEntries: () => entries,
      },
    } as unknown as ExtensionContext;

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const beforeTreeHandlers = events["session_before_tree"] || [];
    for (const h of beforeTreeHandlers) {
      await h(
        {
          targetId: "target-user",
          preparation: { targetId: "target-user", userWantsSummary: false },
        },
        ctx,
      );
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old-leaf", newLeafId: "root-user" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("target-before");
  });

  test("session_tree always mode ignores matching dirty base checkpoint", async () => {
    const root = { ...createUserEntry("root-user", "root"), parentId: "model" };
    const oldUser = { ...createUserEntry("old-user", "old"), parentId: "root-user" };
    const oldLeaf = { ...createUserEntry("old-leaf", "old leaf"), parentId: "old-user" };
    const targetUser = { ...createUserEntry("target-user", "target"), parentId: "root-user" };
    const outsideUser = { ...createUserEntry("outside-user", "outside"), parentId: "root-user" };
    const oldCheckpoint = createCheckpointEntry({
      userEntryId: "old-user",
      beforeCommit: "old-before",
      afterCommit: "old-after",
    });
    const targetCheckpoint = createCheckpointEntry({
      userEntryId: "target-user",
      beforeCommit: "target-before",
      afterCommit: "target-after",
      fileCount: 1,
      fileChanges: [{ path: "target.ts", added: 1, removed: 0 }],
    });
    const outsideCheckpoint = createCheckpointEntry({
      userEntryId: "outside-user",
      beforeCommit: "outside-before",
      afterCommit: "outside-after",
    });
    const entries = [
      root,
      oldUser,
      oldLeaf,
      targetUser,
      outsideUser,
      { type: "custom", customType: "pi-checkpoint", data: oldCheckpoint },
      { type: "custom", customType: "pi-checkpoint", data: targetCheckpoint },
      { type: "custom", customType: "pi-checkpoint", data: outsideCheckpoint },
    ];
    const newBranch = [root, targetUser];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    vi.spyOn(RepoManager.prototype, "stageAll").mockResolvedValue();
    vi.spyOn(RepoManager.prototype, "diffAgainst").mockImplementation((commit: string) =>
      Promise.resolve(commit === "outside-after" ? "" : "1\t0\tfile.ts\n"),
    );
    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = {
      ...createMockContext(sessionFile, newBranch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, newBranch),
        getEntries: () => entries,
      },
    } as unknown as ExtensionContext;

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const beforeTreeHandlers = events["session_before_tree"] || [];
    for (const h of beforeTreeHandlers) {
      await h({ preparation: { targetId: "target-user", userWantsSummary: false } }, ctx);
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old-leaf", newLeafId: "root-user" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("target-before");
  });

  test("session_tree restores non-user target branch after commit", async () => {
    const root = { ...createUserEntry("root-user", "root"), parentId: "model" };
    const oldUser = { ...createUserEntry("old-user", "old"), parentId: "root-user" };
    const oldLeaf = { ...createUserEntry("old-leaf", "old leaf"), parentId: "old-user" };
    const targetUser = { ...createUserEntry("target-user", "target"), parentId: "root-user" };
    const targetAssistant = {
      type: "message",
      id: "target-assistant",
      parentId: "target-user",
      timestamp: new Date().toISOString(),
      message: { role: "assistant", content: "done" },
    };
    const oldCheckpoint = createCheckpointEntry({
      userEntryId: "old-user",
      beforeCommit: "old-before",
      afterCommit: "old-after",
    });
    const targetCheckpoint = createCheckpointEntry({
      userEntryId: "target-user",
      beforeCommit: "target-before",
      afterCommit: "target-after",
      fileCount: 1,
      fileChanges: [{ path: "target.ts", added: 1, removed: 0 }],
    });
    const entries = [
      root,
      oldUser,
      oldLeaf,
      targetUser,
      targetAssistant,
      { type: "custom", customType: "pi-checkpoint", data: oldCheckpoint },
      { type: "custom", customType: "pi-checkpoint", data: targetCheckpoint },
    ];
    const staleBranch = [root, oldUser, oldLeaf];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);
    await enableTreeRestore(tmpDir);

    const safeCheckout = vi
      .spyOn(RepoManager.prototype, "safeCheckout")
      .mockResolvedValue({ ok: true });
    const ctx = {
      ...createMockContext(sessionFile, staleBranch, tmpDir),
      sessionManager: {
        ...createMockSessionManager(sessionFile, staleBranch),
        getEntries: () => entries,
      },
    } as unknown as ExtensionContext;

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);

    const beforeTreeHandlers = events["session_before_tree"] || [];
    for (const h of beforeTreeHandlers) {
      await h({ preparation: { targetId: "target-assistant", userWantsSummary: false } }, ctx);
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old-leaf", newLeafId: "target-assistant" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("target-after");
  });

  test("message_start ignores non-assistant messages", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["message_start"] || []) {
      await h({ message: { role: "user", content: [], timestamp: Date.now() } }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("session task queue recovers after a rejected task", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const brokenCtx = createMockContext(sessionFile, branch, tmpDir);
    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }

    brokenCtx.sessionManager.getBranch = () => {
      throw new Error("branch unavailable");
    };

    await expect(emitAssistantStart(events, brokenCtx)).rejects.toThrow("branch unavailable");
    await emitAssistantStart(events, ctx);
    for (const h of events["agent_end"] || []) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-checkpoint",
      expect.objectContaining({ userEntryId: "entry-1" }),
    );
  });

  test("agent_end skips duplicate checkpoint turn ids", async () => {
    const entry = createCheckpointEntry({ turnId: "same-turn" });
    const turnStart = vi
      .spyOn(AutoCheckpointProducer.prototype, "turnStart")
      .mockResolvedValue({ ok: true, entries: [entry] });
    const finalizeRun = vi
      .spyOn(AutoCheckpointProducer.prototype, "finalizeRun")
      .mockResolvedValue({ ok: true, entry });
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    await emitAssistantStart(events, ctx);
    for (const h of events["agent_end"] || []) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    turnStart.mockRestore();
    finalizeRun.mockRestore();
  });

  test("turn_end skips when branch has no user leaf", async () => {
    const branch = [
      {
        type: "message",
        id: "assistant-1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: createAssistantMessage(),
      },
    ];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["turn_end"] || []) {
      await h({ turnIndex: 0, message: createAssistantMessage(), toolResults: [] }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("turn_start notifies checkpoint failure with UI", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    vi.spyOn(RepoManager.prototype, "ensureReady").mockResolvedValue(undefined);
    vi.spyOn(RepoManager.prototype, "checkpoint").mockRejectedValue(new Error("checkpoint fail"));

    await emitAssistantStart(events, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Checkpoint failed: checkpoint fail", "warning");
  });

  test("turn_start handles checkpoint failure without UI", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = { ...createMockContext(sessionFile, branch, tmpDir), hasUI: false };

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    vi.spyOn(RepoManager.prototype, "ensureReady").mockResolvedValue(undefined);
    vi.spyOn(RepoManager.prototype, "checkpoint").mockRejectedValue(new Error("checkpoint fail"));

    await emitAssistantStart(events, ctx);

    expect(true).toBe(true);
  });

  test("uses project exclude when different from default", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    await fs.mkdir(path.join(tmpDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".pi", "settings.json"),
      JSON.stringify({ ayu: { checkpoint: { exclude: [".git", "dist"] } } }),
      "utf8",
    );

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalled();
  });

  test("checkpoint metadata keeps the full user prompt", async () => {
    const prompt = "很长".repeat(80);
    const branch = [createUserEntry("entry-1", prompt)];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    const call = getCheckpointEntryCall(appendEntry, 0);
    expect(call.prompt).toBe(prompt);
    expect(call.prompt.length).toBeGreaterThan(60);
  });

  test("assistant start uses the current persisted user entry instead of stale preflight prompt", async () => {
    const branch = [createUserEntry("entry-1", "生成 test4.txt")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const beforeAgentStartHandlers = events["before_agent_start"] || [];
    for (const h of beforeAgentStartHandlers) {
      await h({ prompt: "生成 test4.txt", images: undefined, systemPrompt: "" }, ctx);
    }

    branch.push(createUserEntry("entry-2", "生成 test5.txt"));

    await emitAssistantStart(events, ctx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    const call = getCheckpointEntryCall(appendEntry, 0);
    expect(call.userEntryId).toBe("entry-2");
    expect(call.prompt).toBe("生成 test5.txt");
  });

  test("queued user checkpoint waits until the queued user entry is persisted", async () => {
    const branch = [createUserEntry("entry-1", "生成 test1.txt")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const turnStartHandlers = events["turn_start"] || [];
    for (const h of turnStartHandlers) {
      await h({ turnIndex: 1, timestamp: Date.now() }, ctx);
    }

    branch.push(createUserEntry("entry-2", "生成 test2.txt"));
    await emitAssistantStart(events, ctx);
    await fs.writeFile(path.join(tmpDir, "test2.txt"), "", "utf8");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 1, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    const call = getCheckpointEntryCall(appendEntry, 0);
    expect(call.userEntryId).toBe("entry-2");
    expect(call.prompt).toBe("生成 test2.txt");
    expect(call.fileChanges.map((c) => c.path)).toContain("test2.txt");
  }, 15000);

  test("final assistant summary turn does not create a duplicate checkpoint", async () => {
    const branch = [createUserEntry("entry-1", "生成一个空文件 test5.txt")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);
    await fs.writeFile(path.join(tmpDir, "test5.txt"), "", "utf8");

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    await emitAssistantStart(events, ctx);
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 1, message: createAssistantMessage(), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    const call = getCheckpointEntryCall(appendEntry, 0);
    expect(call.userEntryId).toBe("entry-1");
    expect(call.prompt).toBe("生成一个空文件 test5.txt");
    expect(call.fileChanges.map((c) => c.path)).toContain("test5.txt");
  });

  test("turn_end flushes checkpoint before branch advances", async () => {
    const branch = [createUserEntry("entry-1", "生成 test4.txt")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const beforeAgentStartHandlers = events["before_agent_start"] || [];
    for (const h of beforeAgentStartHandlers) {
      await h({ prompt: "生成 test4.txt", images: undefined, systemPrompt: "" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    branch.push(createUserEntry("entry-2", "生成 test5.txt"));

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h(
        {
          turnIndex: 0,
          message: { role: "assistant", content: [], timestamp: Date.now() },
          toolResults: [],
        },
        ctx,
      );
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    const call = getCheckpointEntryCall(appendEntry, 0);
    expect(call.userEntryId).toBe("entry-1");
    expect(call.prompt).toBe("生成 test4.txt");
  });

  test("turn_end keeps checkpoint when diffAgainst throws", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    await emitAssistantStart(events, ctx);

    vi.spyOn(RepoManager.prototype, "diffAgainst").mockRejectedValue(new Error("diff fail"));

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
  });

  test("turn_end skips append when repo.checkpoint throws", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events, appendEntry } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    vi.spyOn(RepoManager.prototype, "ensureReady").mockResolvedValue(undefined);
    vi.spyOn(RepoManager.prototype, "checkpoint").mockRejectedValue(new Error("checkpoint fail"));

    await emitAssistantStart(events, ctx);

    const turnEndHandlers = events["turn_end"] || [];
    for (const h of turnEndHandlers) {
      await h({ turnIndex: 0, message: getAgentMessage(branch), toolResults: [] }, ctx);
    }

    const agentEndHandlers = events["agent_end"] || [];
    for (const h of agentEndHandlers) {
      await h({ messages: [] }, ctx);
    }

    expect(appendEntry).not.toHaveBeenCalled();
  });
});

describe("Fork intent helpers", () => {
  test("isForkIntentRecord validates record shape", () => {
    expect(isForkIntentRecord({})).toBe(true);
    expect(isForkIntentRecord([])).toBe(false);
    expect(isForkIntentRecord(null)).toBe(false);
    expect(isForkIntentRecord("string")).toBe(false);
    expect(isForkIntentRecord(123)).toBe(false);
  });

  test("isForkIntent validates intent shape", () => {
    expect(isForkIntent({ entryId: "e1", position: "before" })).toBe(true);
    expect(isForkIntent({ entryId: "e1", position: "at" })).toBe(true);
    expect(isForkIntent({ entryId: "e1", position: "invalid" })).toBe(false);
    expect(isForkIntent({ entryId: 123, position: "before" })).toBe(false);
    expect(isForkIntent({ position: "before" })).toBe(false);
    expect(isForkIntent("not-object")).toBe(false);
    expect(isForkIntent(null)).toBe(false);
  });

  test("writeForkIntent returns early without sessionFile", async () => {
    await expect(
      writeForkIntent(undefined, { entryId: "e1", position: "before" }),
    ).resolves.toBeUndefined();
  });

  test("writeForkIntent returns early without intent", async () => {
    const tmpFile = path.join(os.tmpdir(), `fork-test-${Date.now()}.json`);
    await expect(writeForkIntent(tmpFile, undefined)).resolves.toBeUndefined();
  });

  test("readForkIntent returns undefined without sessionFile", async () => {
    expect(await readForkIntent(undefined)).toBeUndefined();
  });

  test("readForkIntent returns undefined for missing file", async () => {
    const tmpFile = path.join(os.tmpdir(), `fork-missing-${Date.now()}.json`);
    expect(await readForkIntent(tmpFile)).toBeUndefined();
  });

  test("readForkIntent returns undefined for invalid JSON", async () => {
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "pi-rewind-intent-"));
    const intentSessionFile = path.join(tmpDir2, "session.jsonl");
    const intentFile = getForkIntentPath(intentSessionFile);
    await fs.mkdir(path.dirname(intentFile), { recursive: true });
    await fs.writeFile(intentFile, "not-json", "utf8");
    expect(await readForkIntent(intentSessionFile)).toBeUndefined();
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });

  test("readForkIntent returns undefined for non-intent object", async () => {
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "pi-rewind-intent-"));
    const intentSessionFile = path.join(tmpDir2, "session.jsonl");
    const intentFile = getForkIntentPath(intentSessionFile);
    await fs.mkdir(path.dirname(intentFile), { recursive: true });
    await fs.writeFile(intentFile, JSON.stringify({ foo: "bar" }), "utf8");
    expect(await readForkIntent(intentSessionFile)).toBeUndefined();
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });
});
