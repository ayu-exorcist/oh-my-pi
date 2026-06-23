import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { CheckpointSelectorOptions, CheckpointSelectorSession } from "./checkpoint-selector";

const sessionManagerList = vi.fn();
const sessionManagerListAll = vi.fn();
const deleteSessionCheckpointStorage = vi.fn();
const purgeSessionCheckpointStorage = vi.fn();
const listCheckpointStorageManifests = vi.fn();
const readCheckpointStorageManifest = vi.fn();
const writeCheckpointStorageManifest = vi.fn();
let selectorOptions: CheckpointSelectorOptions | undefined;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: {
    list: sessionManagerList,
    listAll: sessionManagerListAll,
  },
}));

vi.mock("@ayulab/pi-checkpoint", () => ({
  deleteSessionCheckpointStorage,
  purgeSessionCheckpointStorage,
  listCheckpointStorageManifests,
  readCheckpointStorageManifest,
  writeCheckpointStorageManifest,
  getRepoDir: (sessionFile: string | undefined) => {
    const base = path.basename(sessionFile ?? "ephemeral.jsonl", ".jsonl");
    return path.join(process.env.HOME ?? process.cwd(), ".repos", base);
  },
}));

vi.mock("./checkpoint-selector", () => ({
  CheckpointSelectorComponent: class {
    constructor(options: CheckpointSelectorOptions) {
      selectorOptions = options;
    }
  },
}));

function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: overrides.id ?? "session-id",
    path: overrides.path ?? path.join(process.cwd(), "session.jsonl"),
    cwd: overrides.cwd ?? process.cwd(),
    created: overrides.created ?? new Date("2026-06-21T00:00:00.000Z"),
    modified: overrides.modified ?? new Date("2026-06-22T00:00:00.000Z"),
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "First prompt",
    allMessagesText: overrides.allMessagesText ?? "First prompt details",
    name: overrides.name,
    parentSessionPath: overrides.parentSessionPath,
  } as SessionInfo;
}

function createCtx(tmpDir: string, custom = true): ExtensionCommandContext {
  const sessionFile = path.join(tmpDir, "active.jsonl");
  return {
    cwd: path.join(tmpDir, "project"),
    ui: {
      select: vi.fn(),
      custom: custom
        ? vi.fn((factory) => {
            const tui = { requestRender: vi.fn() };
            return factory(
              tui,
              {
                fg: (_color: string, text: string) => text,
                bg: (_color: string, text: string) => text,
                bold: (text: string) => text,
              },
              { getKeys: () => ["x"], matches: () => false },
              vi.fn(),
            );
          })
        : undefined,
    },
    sessionManager: {
      getSessionFile: () => sessionFile,
    },
  } as unknown as ExtensionCommandContext;
}

describe("checkpoint command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-checkpoint-command-test-"));
    selectorOptions = undefined;
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
    sessionManagerList.mockReset();
    sessionManagerListAll.mockReset();
    deleteSessionCheckpointStorage.mockReset();
    purgeSessionCheckpointStorage.mockReset();
    listCheckpointStorageManifests.mockReset();
    readCheckpointStorageManifest.mockReset();
    writeCheckpointStorageManifest.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("falls back to a plain select list when custom UI is unavailable", async () => {
    const live = createSession({
      id: "live-1",
      path: path.join(tmpDir, "live-1.jsonl"),
      cwd: path.join(tmpDir, "project"),
      name: "Live session",
      firstMessage: "Live first",
    });
    const unnamed = createSession({
      id: "live-2",
      path: path.join(tmpDir, "live-2.jsonl"),
      cwd: path.join(tmpDir, "project"),
      firstMessage: "Fallback label",
    });
    const liveRepo = path.join(tmpDir, ".repos", "live-1", ".git");
    const unnamedRepo = path.join(tmpDir, ".repos", "live-2", ".git");
    await fs.mkdir(liveRepo, { recursive: true });
    await fs.mkdir(unnamedRepo, { recursive: true });
    sessionManagerList.mockResolvedValue([live, unnamed]);
    listCheckpointStorageManifests.mockResolvedValue([]);
    readCheckpointStorageManifest.mockResolvedValue(undefined);

    const { registerCheckpointStorageCommand } = await import("./checkpoint");
    const registerCommand = vi.fn();
    registerCheckpointStorageCommand({ registerCommand } as unknown as ExtensionAPI);
    const handler = registerCommand.mock.calls[0]?.[1]?.handler;
    if (!handler) throw new Error("expected checkpoint handler");

    const ctx = createCtx(tmpDir, false);
    await handler("", ctx);

    expect(ctx.ui.select).toHaveBeenCalledWith("Checkpoint Storage:", [
      "Live session",
      "Fallback label",
    ]);
    expect(writeCheckpointStorageManifest).toHaveBeenCalledWith(
      path.join(tmpDir, ".repos", "live-1"),
      expect.objectContaining({ sessionId: "live-1", firstUserMessage: "Live session" }),
    );
  });

  test("custom UI exposes current/all loaders and delete actions", async () => {
    const cwd = path.join(tmpDir, "project");
    const liveWithRepo = createSession({
      id: "live-repo",
      path: path.join(tmpDir, "live-repo.jsonl"),
      cwd,
      name: "Named session",
      parentSessionPath: path.join(tmpDir, "parent.jsonl"),
    });
    const parent = createSession({
      id: "parent",
      path: path.join(tmpDir, "parent.jsonl"),
      cwd,
      firstMessage: "Parent message",
    });
    const liveNoRepo = createSession({
      id: "live-no-repo",
      path: path.join(tmpDir, "live-no-repo.jsonl"),
      cwd: path.join(tmpDir, "other"),
      firstMessage: "No repo session",
      allMessagesText: "No repo session details",
    });
    const untitledEmpty = createSession({
      id: "untitled",
      path: path.join(tmpDir, "untitled.jsonl"),
      cwd,
      firstMessage: "Untitled session",
      messageCount: 0,
    });

    await fs.mkdir(path.join(tmpDir, ".repos", "live-repo", ".git"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".repos", "parent", ".git"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".repos", "active", ".git"), { recursive: true });

    sessionManagerList.mockResolvedValue([parent, liveWithRepo, untitledEmpty]);
    sessionManagerListAll.mockResolvedValue([parent, liveWithRepo, liveNoRepo, untitledEmpty]);
    readCheckpointStorageManifest.mockResolvedValue(undefined);
    listCheckpointStorageManifests.mockResolvedValue([
      {
        repoDir: path.join(tmpDir, ".repos", "orphan"),
        modifiedAt: "2026-06-23T00:00:00.000Z",
        manifest: {
          version: 1,
          sessionId: "orphan-id",
          sessionFile: path.join(tmpDir, "orphan.jsonl"),
          cwd,
          firstUserMessage: "Orphan checkpoint",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
      },
      {
        repoDir: path.join(tmpDir, ".repos", "skip-no-checkpoints"),
        modifiedAt: "2026-06-22T12:00:00.000Z",
        manifest: {
          version: 1,
          sessionId: "live-no-repo",
          sessionFile: liveNoRepo.path,
          cwd: liveNoRepo.cwd,
          firstUserMessage: "No repo session",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
      },
      {
        repoDir: path.join(tmpDir, ".repos", "skip-untitled"),
        modifiedAt: "2026-06-22T12:00:00.000Z",
        manifest: {
          version: 1,
          sessionId: "skip-untitled",
          sessionFile: path.join(tmpDir, "skip-untitled.jsonl"),
          cwd,
          firstUserMessage: "Untitled session",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    ]);
    deleteSessionCheckpointStorage.mockResolvedValue({ ok: true });
    purgeSessionCheckpointStorage.mockResolvedValue({ ok: true });

    const { registerCheckpointStorageCommand } = await import("./checkpoint");
    const registerCommand = vi.fn();
    registerCheckpointStorageCommand({ registerCommand } as unknown as ExtensionAPI);
    const handler = registerCommand.mock.calls[0]?.[1]?.handler;
    if (!handler) throw new Error("expected checkpoint handler");

    const ctx = createCtx(tmpDir, true);
    await handler("", ctx);

    expect(selectorOptions).toBeDefined();
    const currentSessions = await selectorOptions!.currentLoader();
    expect(currentSessions.map((session) => session.id)).toEqual([
      "parent",
      "live-repo",
      "orphan-id",
    ]);
    expect(currentSessions[1]?.path).toBe(path.join(tmpDir, ".repos", "live-repo"));
    expect(currentSessions[1]?.parentSessionPath).toBe(path.join(tmpDir, ".repos", "parent"));
    expect(currentSessions[2]?.checkpointStatus).toBe("no session");

    const allSessions = await selectorOptions!.allLoader();
    expect(allSessions.map((session) => session.checkpointStatus ?? "live")).toEqual([
      "live",
      "live",
      "no checkpoints",
      "no session",
    ]);

    const deleteLive = await selectorOptions!.deleteStorage(currentSessions[0]!);
    expect(deleteLive).toEqual({ ok: true });
    expect(deleteSessionCheckpointStorage).toHaveBeenCalledWith(
      path.join(tmpDir, ".repos", "parent"),
      path.join(tmpDir, "active.jsonl"),
    );

    const deleteOrphan = await selectorOptions!.deleteStorage(currentSessions[2]!);
    expect(deleteOrphan).toEqual({ ok: true });
    expect(purgeSessionCheckpointStorage).toHaveBeenCalledWith(
      path.join(tmpDir, ".repos", "orphan"),
      path.join(tmpDir, "active.jsonl"),
    );

    const missingStorage = await selectorOptions!.deleteStorage({
      ...liveNoRepo,
      checkpointRepoDir: undefined,
      sourceSessionFile: liveNoRepo.path,
      checkpointStatus: "no checkpoints",
    } as CheckpointSelectorSession);
    expect(missingStorage).toEqual({
      ok: false,
      message: "This session has no checkpoint storage to delete",
    });
  });

  test("surfaces delete failures through the selector callback", async () => {
    const live = createSession({
      id: "live-failure",
      path: path.join(tmpDir, "live-failure.jsonl"),
      cwd: path.join(tmpDir, "project"),
      firstMessage: "Failure case",
    });
    await fs.mkdir(path.join(tmpDir, ".repos", "live-failure", ".git"), { recursive: true });
    sessionManagerList.mockResolvedValue([live]);
    sessionManagerListAll.mockResolvedValue([live]);
    listCheckpointStorageManifests.mockResolvedValue([]);
    deleteSessionCheckpointStorage.mockResolvedValue({ ok: false, message: "blocked" });

    const { registerCheckpointStorageCommand } = await import("./checkpoint");
    const registerCommand = vi.fn();
    registerCheckpointStorageCommand({ registerCommand } as unknown as ExtensionAPI);
    const handler = registerCommand.mock.calls[0]?.[1]?.handler;
    if (!handler) throw new Error("expected checkpoint handler");

    const ctx = createCtx(tmpDir, true);
    await handler("", ctx);

    const sessions = await selectorOptions!.currentLoader();
    await expect(selectorOptions!.deleteStorage(sessions[0]!)).resolves.toEqual({
      ok: false,
      message: "blocked",
    });
  });

  test("covers direct helper branches for checkpoint sessions", async () => {
    const { __checkpointCommandTestOnly } = await import("./checkpoint");
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const cwd = path.join(tmpDir, "project");
    const namedSession = createSession({
      id: "named",
      path: path.join(tmpDir, "named.jsonl"),
      cwd,
      name: "  Named session  ",
      firstMessage: " First message ",
      modified: { toISOString: () => "" } as unknown as Date,
    });
    const parent = createSession({
      id: "parent-helper",
      path: path.join(tmpDir, "parent-helper.jsonl"),
      cwd,
      firstMessage: "Parent",
    });
    await fs.mkdir(path.join(tmpDir, ".repos", "named", ".git"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".repos", "parent-helper", ".git"), { recursive: true });
    sessionManagerList.mockResolvedValue([
      parent,
      { ...namedSession, parentSessionPath: parent.path },
    ]);
    listCheckpointStorageManifests.mockResolvedValue([
      {
        repoDir: path.join(tmpDir, ".repos", "skip-same-path"),
        modifiedAt: "not-a-date",
        manifest: {
          version: 1,
          sessionId: "skip",
          sessionFile: namedSession.path,
          cwd,
          firstUserMessage: "Named session",
          createdAt: "also-bad",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    ]);
    readCheckpointStorageManifest.mockResolvedValue({
      createdAt: "2026-06-20T00:00:00.000Z",
      firstUserMessage: "existing",
    });

    const sessions = await __checkpointCommandTestOnly.buildCheckpointSessions(cwd, "current");
    expect(sessions[1]?.parentSessionPath).toBe(path.join(tmpDir, ".repos", "parent-helper"));
    expect(writeCheckpointStorageManifest).toHaveBeenNthCalledWith(
      2,
      path.join(tmpDir, ".repos", "named"),
      expect.objectContaining({ createdAt: "2026-06-20T00:00:00.000Z" }),
    );
    expect(__checkpointCommandTestOnly.normalizeComparablePath("A\\B")).toBe(path.resolve("A\\B"));
    expect(__checkpointCommandTestOnly.normalizeTitle(undefined)).toBe("Untitled session");
    expect(__checkpointCommandTestOnly.toDate("bad-date") instanceof Date).toBe(true);
  });

  test("skips empty untitled live sessions before syncing manifests", async () => {
    const { __checkpointCommandTestOnly } = await import("./checkpoint");
    const cwd = path.join(tmpDir, "project");
    sessionManagerList.mockResolvedValue([
      createSession({
        id: "untitled",
        path: path.join(tmpDir, "untitled.jsonl"),
        cwd,
        firstMessage: "Untitled session",
        messageCount: 0,
      }),
    ]);
    listCheckpointStorageManifests.mockResolvedValue([]);

    await __checkpointCommandTestOnly.syncLiveSessionManifest(
      createSession({
        id: "direct-untitled",
        path: path.join(tmpDir, "direct-untitled.jsonl"),
        cwd,
        firstMessage: "Untitled session",
        messageCount: 0,
      }),
    );
    await expect(
      __checkpointCommandTestOnly.buildCheckpointSessions(cwd, "current"),
    ).resolves.toEqual([]);
    expect(writeCheckpointStorageManifest).not.toHaveBeenCalled();
  });

  test("includes live sessions without checkpoint repos in the all-scope list", async () => {
    const { __checkpointCommandTestOnly } = await import("./checkpoint");
    const cwd = path.join(tmpDir, "project");
    const repoLess = createSession({
      id: "repo-less-only",
      path: path.join(tmpDir, "repo-less-only.jsonl"),
      cwd,
      firstMessage: "Repo less only",
      allMessagesText: "Repo less only details",
    });
    sessionManagerListAll.mockResolvedValue([repoLess]);
    listCheckpointStorageManifests.mockResolvedValue([]);

    const sessions = await __checkpointCommandTestOnly.buildCheckpointSessions(cwd, "all");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.checkpointStatus).toBe("no checkpoints");
  });

  test("does not show repo-less sessions in the current-scope list", async () => {
    const { __checkpointCommandTestOnly } = await import("./checkpoint");
    const cwd = path.join(tmpDir, "project");
    sessionManagerList.mockResolvedValue([
      createSession({
        id: "repo-less-current",
        path: path.join(tmpDir, "repo-less-current.jsonl"),
        cwd,
        firstMessage: "Repo less current",
      }),
    ]);
    listCheckpointStorageManifests.mockResolvedValue([]);

    await expect(
      __checkpointCommandTestOnly.buildCheckpointSessions(cwd, "current"),
    ).resolves.toEqual([]);
  });

  test("skips orphan manifests that already match a live no-checkpoint session path", async () => {
    const { __checkpointCommandTestOnly } = await import("./checkpoint");
    const cwd = path.join(tmpDir, "project");
    const parent = createSession({
      id: "parent-no-repo",
      path: path.join(tmpDir, "parent-no-repo.jsonl"),
      cwd,
      firstMessage: "Parent no repo",
    });
    const noRepo = createSession({
      id: "no-repo",
      path: path.join(tmpDir, "no-repo.jsonl"),
      cwd,
      name: " No Repo Session ",
      firstMessage: " First repo-less message ",
      allMessagesText: "No repo details",
      parentSessionPath: parent.path,
    });
    sessionManagerListAll.mockResolvedValue([parent, noRepo]);
    listCheckpointStorageManifests.mockResolvedValue([
      {
        repoDir: path.join(tmpDir, ".repos", "duplicate"),
        modifiedAt: "2026-06-22T00:00:00.000Z",
        manifest: {
          version: 1,
          sessionId: "other-id",
          sessionFile: noRepo.path,
          cwd,
          firstUserMessage: "No repo",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    ]);

    const sessions = await __checkpointCommandTestOnly.buildCheckpointSessions(cwd, "all");
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.checkpointStatus).toBe("no checkpoints");
    expect(sessions[1]?.name).toBe("No Repo Session");
    expect(sessions[1]?.firstMessage).toBe("First repo-less message");
    expect(sessions[1]?.parentSessionPath).toBe(parent.path);
  });

  test("skips manifests for repo directories already represented by live sessions", async () => {
    const { __checkpointCommandTestOnly } = await import("./checkpoint");
    const cwd = path.join(tmpDir, "project");
    const live = createSession({
      id: "live-represented",
      path: path.join(tmpDir, "live-represented.jsonl"),
      cwd,
      firstMessage: "Live represented",
    });
    await fs.mkdir(path.join(tmpDir, ".repos", "live-represented", ".git"), { recursive: true });
    sessionManagerList.mockResolvedValue([live]);
    listCheckpointStorageManifests.mockResolvedValue([
      {
        repoDir: path.join(tmpDir, ".repos", "live-represented"),
        modifiedAt: "2026-06-22T00:00:00.000Z",
        manifest: {
          version: 1,
          sessionId: "other",
          sessionFile: path.join(tmpDir, "other.jsonl"),
          cwd,
          firstUserMessage: "Other",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    ]);

    const sessions = await __checkpointCommandTestOnly.buildCheckpointSessions(cwd, "current");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe("live-represented");
  });

  test("uses session file fallback when current repo does not exist and wires selector callbacks", async () => {
    sessionManagerList.mockResolvedValue([]);
    sessionManagerListAll.mockResolvedValue([]);
    listCheckpointStorageManifests.mockResolvedValue([]);

    const { registerCheckpointStorageCommand } = await import("./checkpoint");
    const registerCommand = vi.fn();
    registerCheckpointStorageCommand({ registerCommand } as unknown as ExtensionAPI);
    const handler = registerCommand.mock.calls[0]?.[1]?.handler;
    if (!handler) throw new Error("expected checkpoint handler");

    const done = vi.fn();
    const requestRender = vi.fn();
    const ctx = {
      cwd: path.join(tmpDir, "project"),
      ui: {
        custom: vi.fn((factory) =>
          factory(
            { requestRender },
            {
              fg: (_color: string, text: string) => text,
              bg: (_color: string, text: string) => text,
              bold: (text: string) => text,
            },
            { getKeys: () => ["x"], matches: () => false },
            done,
          ),
        ),
      },
      sessionManager: {
        getSessionFile: () => undefined,
      },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    expect(selectorOptions?.currentSessionPath).toBe(path.join(tmpDir, ".repos", "ephemeral"));
    selectorOptions?.requestRender();
    selectorOptions?.onClose();
    expect(requestRender).toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(undefined);
  });
});
