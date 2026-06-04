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
import type { CheckpointEntry } from "@ayulab/pi-checkpoint";
import { isForkIntent, isForkIntentRecord, readForkIntent, writeForkIntent } from "./index";

function createMockApi(): {
  api: ExtensionAPI;
  events: Record<string, Array<(...args: unknown[]) => unknown>>;
  registerCommand: ReturnType<typeof vi.fn>;
  appendEntry: ReturnType<typeof vi.fn>;
} {
  const events: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const registerCommand = vi.fn();
  const appendEntry = vi.fn();

  const api = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      events[event] = events[event] || [];
      events[event].push(handler);
    },
    registerCommand,
    appendEntry,
  } as unknown as ExtensionAPI;

  return { api, events, registerCommand, appendEntry };
}

function createMockSessionManager(sessionFile: string, branch: SessionEntry[] = []) {
  return {
    getSessionFile: () => sessionFile,
    getSessionId: () => "test-session",
    getLeafEntry: () => {
      const leaf = branch[branch.length - 1];
      if (!leaf || leaf.type !== "message") return undefined;
      return { id: leaf.id, type: leaf.type, message: leaf.message };
    },
    getBranch: () => branch,
    getEntries: () => branch,
  };
}

function expectCheckpointEntryCall(
  mock: ReturnType<typeof vi.fn>,
  index: number,
): [string, CheckpointEntry] {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`expected mock call ${index}`);
  const [customType, entry] = call;
  if (customType !== "pi-checkpoint") throw new Error("expected pi-checkpoint entry");
  return [customType, entry as CheckpointEntry];
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
  events: Record<string, Array<(...args: unknown[]) => unknown>>,
  ctx: ExtensionContext,
): Promise<void> {
  const message = createAssistantMessage();
  const messageStartHandlers = events["message_start"] || [];
  for (const h of messageStartHandlers) {
    await h({ message }, ctx);
  }
}

function createMockContext(sessionFile: string, branch: unknown[], cwd: string): ExtensionContext {
  return {
    sessionManager: createMockSessionManager(sessionFile, branch as SessionEntry[]),
    cwd,
    ui: { notify: vi.fn() },
    hasUI: true,
  } as unknown as ExtensionContext;
}

async function createTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pi-rewind-test-"));
}

async function enableTreeRestore(cwd: string): Promise<void> {
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".pi", "settings.json"),
    JSON.stringify({ ayu: { rewind: { restoreOnTree: "always" } } }),
    "utf8",
  );
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
      .filter(
        (call: unknown[]) => Array.isArray(call) && call.length >= 2 && call[0] === "pi-checkpoint",
      )
      .map((call: unknown[]) => call[1])
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
      .filter(
        (call: unknown[]) => Array.isArray(call) && call.length >= 2 && call[0] === "pi-checkpoint",
      )
      .map((call: unknown[]) => call[1])
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
      .filter(
        (call: unknown[]) => Array.isArray(call) && call.length >= 2 && call[0] === "pi-checkpoint",
      )
      .map((call: unknown[]) => call[1])
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
      .filter(
        (call: unknown[]) => Array.isArray(call) && call.length >= 2 && call[0] === "pi-checkpoint",
      )
      .map((call: unknown[]) => call[1])
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
      .filter(
        (call: unknown[]) => Array.isArray(call) && call.length >= 2 && call[0] === "pi-checkpoint",
      )
      .map((call: unknown[]) => call[1])
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
  }, 15000);

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
      await h({ preparation: { targetId: "target-user" } }, ctx);
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
      await h({ preparation: { targetId: "target-user" } }, ctx);
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
      await h({ preparation: { targetId: "target-assistant" } }, ctx);
    }

    const treeHandlers = events["session_tree"] || [];
    for (const h of treeHandlers) {
      await h({ oldLeafId: "old-leaf", newLeafId: "target-assistant" }, ctx);
    }

    expect(safeCheckout).toHaveBeenCalledWith("target-after", "old-after");
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
    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].userEntryId).toBe("entry-2");
    expect(call[1].prompt).toBe("生成 test5.txt");
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
    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].userEntryId).toBe("entry-2");
    expect(call[1].prompt).toBe("生成 test2.txt");
    expect(call[1].fileChanges.map((c) => c.path)).toContain("test2.txt");
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
    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].userEntryId).toBe("entry-1");
    expect(call[1].prompt).toBe("生成一个空文件 test5.txt");
    expect(call[1].fileChanges.map((c) => c.path)).toContain("test5.txt");
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
    const call = expectCheckpointEntryCall(appendEntry, 0);
    expect(call[1].userEntryId).toBe("entry-1");
    expect(call[1].prompt).toBe("生成 test4.txt");
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
    const intentFile = path.join(tmpDir2, "fork-intent.json");
    await fs.mkdir(path.dirname(intentFile), { recursive: true });
    await fs.writeFile(intentFile, "not-json", "utf8");
    expect(await readForkIntent(intentFile)).toBeUndefined();
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });

  test("readForkIntent returns undefined for non-intent object", async () => {
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "pi-rewind-intent-"));
    const intentFile = path.join(tmpDir2, "fork-intent.json");
    await fs.mkdir(path.dirname(intentFile), { recursive: true });
    await fs.writeFile(intentFile, JSON.stringify({ foo: "bar" }), "utf8");
    expect(await readForkIntent(intentFile)).toBeUndefined();
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });
});
