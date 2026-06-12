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
import type { CheckpointEntry, SafeCheckoutResult } from "@ayulab/pi-checkpoint";
import {
  getForkIntentPath,
  isForkIntent,
  isForkIntentRecord,
  readForkIntent,
  writeForkIntent,
} from "./index";
import { AutoCheckpointProducer } from "./auto-checkpoint";

type MockEventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

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
  };
  readonly hasUI: boolean;
};

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
): MockSessionManager {
  return {
    getSessionFile: () => sessionFile,
    getSessionId: () => "test-session",
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
): MockContext {
  return {
    sessionManager: createMockSessionManager(sessionFile, branch),
    cwd,
    ui: { notify: vi.fn(), confirm: vi.fn(), select: vi.fn() },
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

  test("session_start skips init when git already exists", async () => {
    const branch = [createUserEntry("entry-1", "test")];
    const { api, events } = createMockApi();
    const ext = await import("./index");
    ext.default(api);

    const ctx = createMockContext(sessionFile, branch, tmpDir);

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    for (const h of sessionStartHandlers) {
      await h({ reason: "resume" }, ctx);
    }

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(true);
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
  });

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
      JSON.stringify({ checkpoint: { restoreOnFork: "always" } }),
      "utf8",
    );

    const sessionStartHandlers = events["session_start"] || [];
    const srcCtx = createMockContext(sessionFile, branch, tmpDir);
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, srcCtx);
    }

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

    const checkoutCommit = vi.spyOn(RepoManager.prototype, "checkoutCommit").mockResolvedValue();
    const forkCtx = createMockContext(forkSessionFile, branch, tmpDir);
    for (const h of sessionStartHandlers) {
      await h({ reason: "fork", previousSessionFile: sessionFile }, forkCtx);
    }

    expect(checkoutCommit).toHaveBeenCalledWith("root-after");
  });

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
      JSON.stringify({ checkpoint: { restoreOnFork: "always" } }),
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
      JSON.stringify({ checkpoint: { restoreOnClone: "always" } }),
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
      JSON.stringify({ checkpoint: { restoreOnClone: "always" } }),
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

    const forkCtx = createMockContext(forkSessionFile, [], tmpDir);

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
  });

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
  }, 15000);

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
      JSON.stringify({ checkpoint: { restoreOnFork: "never" } }),
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

    const forkCtx = createMockContext(forkSessionFile, [], tmpDir);

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
  });

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
  });

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
  });

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
  });

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
      JSON.stringify({ checkpoint: { enabled: false } }),
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
      JSON.stringify({ checkpoint: { enabled: true, autoCheckpoint: false } }),
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
      JSON.stringify({ checkpoint: { restoreOnClone: "never" } }),
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

  test("resume session_start restores latest branch checkpoint when workspace matches known checkpoint", async () => {
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
      JSON.stringify({ checkpoint: { exclude: [] } }),
      "utf8",
    );

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
      await h({ reason: "resume" }, ctx);
    }

    const repoDir = path.join(tmpDir, ".pi", "agent", "ayu", "checkpoints", "sessions", "session");
    const gitExists = await fs
      .access(path.join(repoDir, ".git"))
      .then(() => true)
      .catch(() => false);
    expect(gitExists).toBe(true);
    expect(safeCheckout).toHaveBeenCalledWith("resume-after", "resume-after");
  });

  test("resume session_start warns when workspace has unsnapshotted changes", async () => {
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
      JSON.stringify({ checkpoint: { exclude: [] } }),
      "utf8",
    );

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

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Workspace has unsnapshotted changes. Run /checkpoint first, or clean them up before resuming checkpoint state.",
      "warning",
    );
    expect(safeCheckout).not.toHaveBeenCalled();
  });

  test("session_tree keeps Pi-native behavior by default", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
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

    const sessionStartHandlers = events["session_start"] || [];
    for (const h of sessionStartHandlers) {
      await h({ reason: "new" }, ctx);
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

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
          .mockImplementationOnce((_title: string, options: string[]) => options[1])
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

  test("session_tree ask mode restores files only when user confirms sync", async () => {
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
    ctx.ui.select.mockResolvedValueOnce("Yes");

    for (const h of events["session_start"] || []) {
      await h({ reason: "new" }, ctx);
    }
    for (const h of events["session_before_tree"] || []) {
      await h({ preparation: { targetId: "entry-1", userWantsSummary: false } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(ctx.ui.select).toHaveBeenCalledWith("Sync files?", ["Yes", "No"]);
    expect(safeCheckout).toHaveBeenCalledWith("before-hash", undefined);
  });

  test("session_tree ask mode without UI keeps native tree behavior", async () => {
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

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after", undefined);
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
    for (const h of events["session_tree"] || []) {
      await h({}, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after", "tree-after");
  });

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
    for (const h of events["session_before_tree"] || []) {
      await h(null, ctx);
      await h({ preparation: "not-object" }, ctx);
      await h({ preparation: { targetId: 123 } }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after", "tree-after");
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
    for (const h of events["session_tree"] || []) {
      await h(null, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after", "tree-after");
  });

  test("session_tree returns when checkpoint storage is not bound", async () => {
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
    const ctx = createMockContext(sessionFile, [], tmpDir);

    for (const h of events["session_start"] || []) {
      await h({ reason: "fork" }, ctx);
    }
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "old", newLeafId: "new" }, ctx);
    }

    expect(safeCheckout).not.toHaveBeenCalled();
  });

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
    for (const h of events["session_tree"] || []) {
      await h({ oldLeafId: "entry-1", newLeafId: "entry-1" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("tree-after", "tree-after");
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

  test("session_tree reports restore failures", async () => {
    const checkpointEntry = createCheckpointEntry({ afterCommit: "tree-after" });
    const branch = [
      createUserEntry("entry-1", "test"),
      { type: "custom", customType: "pi-checkpoint", data: checkpointEntry },
    ];
    const cases: Array<{ readonly result: SafeCheckoutResult; readonly message: string }> = [
      { result: { ok: false, reason: "dirty" }, message: "unsnapshotted changes" },
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
      for (const h of events["session_tree"] || []) {
        await h({ oldLeafId: "old", newLeafId: "entry-1" }, ctx);
      }

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining(message),
        expect.any(String),
      );
      vi.restoreAllMocks();
    }
  });

  test("session_tree uses old branch dirty base and target user before commit", async () => {
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

    expect(safeCheckout).toHaveBeenCalledWith("target-before", "old-after");
  });

  test("session_tree uses matching checkpoint outside old branch as dirty base", async () => {
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

    const beforeTreeHandlers = events["session_before_tree"] || [];
    for (const h of beforeTreeHandlers) {
      await h({ preparation: { targetId: "target-user", userWantsSummary: false } }, ctx);
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old-leaf", newLeafId: "root-user" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("target-before", "outside-after");
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

    const beforeTreeHandlers = events["session_before_tree"] || [];
    for (const h of beforeTreeHandlers) {
      await h({ preparation: { targetId: "target-assistant", userWantsSummary: false } }, ctx);
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old-leaf", newLeafId: "target-assistant" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("target-after", "old-after");
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
      JSON.stringify({ checkpoint: { exclude: [".git", "dist"] } }),
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
  });

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
