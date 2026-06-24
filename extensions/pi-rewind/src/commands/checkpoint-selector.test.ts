import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import {
  __checkpointSelectorTestOnly,
  CheckpointSelectorComponent,
  type CheckpointSelectorKeybindings,
  type CheckpointSelectorOptions,
  type CheckpointSelectorSession,
  type CheckpointSelectorTheme,
} from "./checkpoint-selector";

function flush(): Promise<void> {
  return Promise.resolve();
}

function createSession(
  overrides: Partial<CheckpointSelectorSession> = {},
): CheckpointSelectorSession {
  return {
    id: overrides.id ?? "session-id",
    path: overrides.path ?? "/tmp/session.jsonl",
    cwd: overrides.cwd ?? "/tmp/project",
    created: overrides.created ?? new Date("2026-06-20T00:00:00.000Z"),
    modified: overrides.modified ?? new Date(),
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "First prompt",
    allMessagesText: overrides.allMessagesText ?? "First prompt details",
    name: overrides.name,
    parentSessionPath: overrides.parentSessionPath,
    checkpointRepoDir: overrides.checkpointRepoDir,
    sourceSessionFile: overrides.sourceSessionFile,
    checkpointStatus: overrides.checkpointStatus,
  } as SessionInfo & CheckpointSelectorSession;
}

function createTheme(): CheckpointSelectorTheme {
  return {
    fg: (_color, text) => text,
    bg: (_color, text) => `[bg]${text}`,
    bold: (text) => `*${text}*`,
  };
}

function createKeybindings(): CheckpointSelectorKeybindings {
  const map: Record<string, readonly string[]> = {
    "tui.input.tab": ["tab"],
    "app.session.toggleSort": ["sort"],
    "app.session.toggleNamedFilter": ["named"],
    "app.session.togglePath": ["path"],
    "app.session.delete": ["delete"],
    "tui.select.up": ["up"],
    "tui.select.down": ["down"],
    "tui.select.pageUp": ["pageup"],
    "tui.select.pageDown": ["pagedown"],
    "tui.select.confirm": ["enter"],
    "tui.select.cancel": ["escape"],
  };
  return {
    getKeys: (keybinding) => map[keybinding] ?? [keybinding],
    matches: (keyData, keybinding) => (map[keybinding] ?? []).includes(keyData),
  };
}

function createOptions(
  overrides: Partial<CheckpointSelectorOptions> = {},
): CheckpointSelectorOptions & {
  readonly requestRender: ReturnType<typeof vi.fn<() => void>>;
  readonly onClose: ReturnType<typeof vi.fn<() => void>>;
} {
  const requestRender = vi.fn<() => void>();
  const onClose = vi.fn<() => void>();
  return {
    currentLoader: overrides.currentLoader ?? vi.fn().mockResolvedValue([]),
    allLoader: overrides.allLoader ?? vi.fn().mockResolvedValue([]),
    deleteStorage: overrides.deleteStorage ?? vi.fn().mockResolvedValue({ ok: true }),
    ...(overrides.currentSessionPath ? { currentSessionPath: overrides.currentSessionPath } : {}),
    requestRender,
    onClose,
    theme: overrides.theme ?? createTheme(),
    keybindings: overrides.keybindings ?? createKeybindings(),
  };
}

describe("checkpoint selector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00.000Z"));
    process.env.HOME = "/home/tester";
    process.env.USERPROFILE = "/home/tester";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("renders loading progress, empty state, and status variants", async () => {
    let progressCallback: ((loaded: number, total: number) => void) | undefined;
    let resolveCurrent!: (sessions: CheckpointSelectorSession[]) => void;
    const currentLoader = vi.fn(
      (onProgress?: (loaded: number, total: number) => void) =>
        new Promise<CheckpointSelectorSession[]>((resolve) => {
          progressCallback = onProgress;
          resolveCurrent = resolve;
        }),
    );
    const component = new CheckpointSelectorComponent(createOptions({ currentLoader }));

    expect(component.render(80).join("\n")).toContain("Loading ...");

    progressCallback?.(1, 3);
    expect(component.render(80).join("\n")).toContain("Loading 1/3");

    resolveCurrent([]);
    await flush();
    expect(component.render(80).join("\n")).toContain("No sessions found");

    const header = (component as any).header;
    header.setConfirmingDelete("no session");
    expect(header.render(80).join("\n")).toContain("Delete orphan checkpoint storage?");
    header.setConfirmingDelete("storage");
    expect(header.render(80).join("\n")).toContain("Delete checkpoint storage?");
    header.setConfirmingDelete(false);

    header.setStatusMessage({ type: "info", message: "Done" }, 10);
    expect(header.render(80).join("\n")).toContain("Done");
    await vi.advanceTimersByTimeAsync(10);
    expect(header.render(80).join("\n")).not.toContain("Done");
  });

  test("filters and sorts sessions across threaded, recent, relevance, regex, and phrases", async () => {
    const sessions = [
      createSession({
        id: "root",
        path: "/tmp/root.jsonl",
        firstMessage: "Root alpha",
        allMessagesText: "Root alpha text",
        modified: new Date("2026-06-22T11:59:00.000Z"),
      }),
      createSession({
        id: "child",
        path: "/tmp/child.jsonl",
        parentSessionPath: "/tmp/root.jsonl",
        name: "Child session",
        firstMessage: "Quoted exact phrase",
        allMessagesText: "Quoted exact phrase body",
        modified: new Date("2026-06-22T11:58:00.000Z"),
      }),
      createSession({
        id: "orphan",
        path: "/tmp/orphan.jsonl",
        firstMessage: "Beta prompt",
        allMessagesText: "Beta details",
        modified: new Date("2026-06-22T11:57:00.000Z"),
        checkpointStatus: "no session",
      }),
    ];
    const component = new CheckpointSelectorComponent(
      createOptions({ currentLoader: vi.fn().mockResolvedValue(sessions) }),
    );
    await flush();

    const threaded = (component as any).filterSessions(sessions, "");
    expect(threaded).toHaveLength(3);
    expect(threaded[1]?.depth).toBe(1);

    (component as any).sortMode = "recent";
    let filtered = (component as any).filterSessions(sessions, "beta");
    expect(
      filtered.map((entry: { session: CheckpointSelectorSession }) => entry.session.id),
    ).toEqual(["orphan"]);

    (component as any).sortMode = "relevance";
    filtered = (component as any).filterSessions(sessions, '"exact phrase"');
    expect(
      filtered.map((entry: { session: CheckpointSelectorSession }) => entry.session.id),
    ).toEqual(["child"]);

    filtered = (component as any).filterSessions(sessions, "re:root");
    expect(
      filtered.map((entry: { session: CheckpointSelectorSession }) => entry.session.id),
    ).toEqual(["root"]);

    expect((component as any).filterSessions(sessions, "re:[")).toEqual([]);
    expect((component as any).filterSessions(sessions, 'unclosed "quote')).toHaveLength(0);

    (component as any).nameFilter = "named";
    filtered = (component as any).filterSessions(sessions, "child");
    expect(
      filtered.map((entry: { session: CheckpointSelectorSession }) => entry.session.id),
    ).toEqual(["child"]);
  });

  test("renders session lines with age buckets, paths, current markers, and control stripping", async () => {
    const component = new CheckpointSelectorComponent(createOptions());
    const renderSessionLine = (component as any).renderSessionLine.bind(component) as (
      node: unknown,
      isSelected: boolean,
      width: number,
    ) => string;
    const node = (session: CheckpointSelectorSession) => ({
      session,
      depth: session.parentSessionPath ? 1 : 0,
      isLast: true,
      ancestorContinues: [],
    });

    (component as any).scope = "current";
    (component as any).showPath = false;
    (component as any).options.currentSessionPath = "/tmp/current.jsonl";

    const ages = [
      [new Date("2026-06-22T11:59:45.000Z"), "now"],
      [new Date("2026-06-22T11:55:00.000Z"), "5m"],
      [new Date("2026-06-22T10:00:00.000Z"), "2h"],
      [new Date("2026-06-19T12:00:00.000Z"), "3d"],
      [new Date("2026-06-08T12:00:00.000Z"), "2w"],
      [new Date("2026-04-01T12:00:00.000Z"), "2mo"],
      [new Date("2025-05-01T12:00:00.000Z"), "1y"],
    ] as const;

    for (const [modified, label] of ages) {
      const line = renderSessionLine(
        node(
          createSession({
            path: "/tmp/current.jsonl",
            firstMessage: "Message\nwith\tcontrols",
            cwd: "/home/tester/project",
            modified,
          }),
        ),
        false,
        200,
      );
      expect(line).toContain(label);
      expect(line).toContain("Message with controls");
    }

    (component as any).scope = "all";
    (component as any).showPath = true;
    const pathLine = renderSessionLine(
      node(
        createSession({
          path: "/home/tester/project/current.jsonl",
          checkpointRepoDir: "/home/tester/project/current.jsonl",
          sourceSessionFile: "/home/tester/project/current.jsonl",
          checkpointStatus: "no checkpoints",
          cwd: "/home/tester/project",
          modified: new Date("2026-06-22T11:00:00.000Z"),
        }),
      ),
      false,
      200,
    );
    expect(pathLine).toContain("~/project/current.jsonl");

    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const plainPathLine = renderSessionLine(
      node(
        createSession({
          path: "/opt/project/session.jsonl",
          cwd: "/opt/project",
          checkpointStatus: "no session",
          modified: new Date("2026-06-22T11:00:00.000Z"),
        }),
      ),
      false,
      120,
    );
    expect(plainPathLine).toContain("/opt/project/session.jsonl");
  });

  test("handles toggles, navigation, search input, and close keys", async () => {
    const currentSessions = [
      createSession({ id: "one", path: "/tmp/one.jsonl", firstMessage: "Alpha prompt" }),
      createSession({ id: "two", path: "/tmp/two.jsonl", firstMessage: "Beta prompt" }),
    ];
    const allSessions = [
      ...currentSessions,
      createSession({ id: "three", path: "/tmp/three.jsonl", name: "Gamma" }),
    ];
    const options = createOptions({
      currentLoader: vi.fn().mockResolvedValue(currentSessions),
      allLoader: vi.fn().mockResolvedValue(allSessions),
    });
    const component = new CheckpointSelectorComponent(options);
    component.focused = true;
    expect(component.focused).toBe(true);
    component.invalidate();
    await flush();

    component.handleInput("down");
    expect((component as any).selectedIndex).toBe(1);
    component.handleInput("up");
    expect((component as any).selectedIndex).toBe(0);
    component.handleInput("pagedown");
    expect((component as any).selectedIndex).toBe(1);
    component.handleInput("pageup");
    expect((component as any).selectedIndex).toBe(0);

    component.handleInput("sort");
    component.handleInput("sort");
    component.handleInput("sort");
    component.handleInput("named");
    component.handleInput("named");
    component.handleInput("path");
    component.handleInput("tab");
    await flush();
    expect((component as any).scope).toBe("all");

    component.handleInput("g");
    expect(options.requestRender).toHaveBeenCalled();

    component.handleInput("enter");
    component.handleInput("escape");
    expect(options.onClose).toHaveBeenCalledTimes(2);
  });

  test("delete flows handle current-session block, cancellation, failures, success, and refresh errors", async () => {
    const current = createSession({
      id: "current",
      path: "/tmp/current.jsonl",
      checkpointRepoDir: "/tmp/current.jsonl",
      sourceSessionFile: "/tmp/current.jsonl",
      name: "Current",
    });
    const removable = createSession({
      id: "removable",
      path: "/tmp/removable-repo",
      checkpointRepoDir: "/tmp/removable-repo",
      sourceSessionFile: "/tmp/removable.jsonl",
      firstMessage: "Remove me",
    });
    const orphan = createSession({
      id: "orphan",
      path: "/tmp/orphan-repo",
      checkpointRepoDir: "/tmp/orphan-repo",
      sourceSessionFile: undefined,
      firstMessage: "Orphan",
      checkpointStatus: "no session",
    });
    const deleteStorage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "blocked" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const options = createOptions({
      currentLoader: vi.fn().mockResolvedValue([current, removable]),
      allLoader: vi
        .fn()
        .mockResolvedValueOnce([current, removable, orphan])
        .mockRejectedValueOnce(new Error("reload failed")),
      deleteStorage,
      currentSessionPath: "/tmp/current.jsonl",
    });
    const component = new CheckpointSelectorComponent(options);
    await flush();

    (component as any).currentSessions = [current, removable];
    (component as any).allSessions = [current, removable, orphan];
    (component as any).scope = "all";
    (component as any).setVisibleSessionsForScope("all");

    (component as any).selectedIndex = 0;
    (component as any).startDeleteConfirmation();
    expect((component as any).header.render(120).join("\n")).toContain(
      "Cannot delete the currently active checkpoint storage",
    );

    (component as any).selectedIndex = 1;
    component.handleInput("delete");
    component.handleInput("escape");
    expect((component as any).confirmingDeletePath).toBeNull();

    component.handleInput("delete");
    component.handleInput("enter");
    await flush();
    expect((component as any).header.render(120).join("\n")).toContain("blocked");

    component.handleInput("delete");
    component.handleInput("enter");
    await flush();
    expect(deleteStorage).toHaveBeenCalledWith(removable);
    expect(
      (component as any).allSessions.some(
        (session: CheckpointSelectorSession) => session.checkpointStatus === "no checkpoints",
      ),
    ).toBe(true);

    (component as any).selectedIndex = (component as any).filteredSessions.findIndex(
      (entry: { session: CheckpointSelectorSession }) => entry.session.id === "orphan",
    );
    await (component as any).confirmDelete();
    await flush();
    await flush();
    expect((component as any).header.render(120).join("\n")).toContain(
      "Checkpoint list refresh failed: reload failed",
    );
  });

  test("renders without a scroll counter for short lists and highlights named sessions", async () => {
    const named = createSession({
      id: "named",
      path: "/tmp/named.jsonl",
      name: "Named",
      firstMessage: "Named",
    });
    const component = new CheckpointSelectorComponent(
      createOptions({ currentLoader: vi.fn().mockResolvedValue([named]) }),
    );
    await flush();

    expect(component.render(80).join("\n")).not.toContain("(1/1)");
    const line = (component as any).renderSessionLine(
      { session: named, depth: 0, isLast: true, ancestorContinues: [] },
      false,
      120,
    );
    expect(line).toContain("Named");
    expect((component as any).applyDeletedCheckpointStorage(null, named, "current")).toEqual([]);
  });

  test("toggles to cached all sessions, back to current, and renders a scroll counter", async () => {
    const sessions = Array.from({ length: 12 }, (_, index) =>
      createSession({
        id: `session-${index}`,
        path: `/tmp/session-${index}.jsonl`,
        firstMessage: `Session ${index}`,
      }),
    );
    const component = new CheckpointSelectorComponent(
      createOptions({
        currentLoader: vi.fn().mockResolvedValue(sessions),
        allLoader: vi.fn().mockResolvedValue(sessions),
      }),
    );
    await flush();

    (component as any).allSessions = sessions;
    component.handleInput("tab");
    expect((component as any).scope).toBe("all");
    component.handleInput("tab");
    expect((component as any).scope).toBe("current");

    (component as any).filteredSessions = sessions.map((session) => ({
      session,
      depth: 0,
      isLast: true,
      ancestorContinues: [],
    }));
    (component as any).selectedIndex = 11;
    expect(component.render(80).join("\n")).toContain("(12/12)");
  });

  test("loadScope preserves sessions on toggle errors and ignores stale all-loader responses", async () => {
    const currentSessions = [createSession({ id: "current", path: "/tmp/current.jsonl" })];
    let resolveFirstAll!: (sessions: CheckpointSelectorSession[]) => void;
    let firstProgress: ((loaded: number, total: number) => void) | undefined;
    const firstAll = new Promise<CheckpointSelectorSession[]>((resolve) => {
      resolveFirstAll = resolve;
    });
    const allLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error("all failed"))
      .mockImplementationOnce((onProgress?: (loaded: number, total: number) => void) => {
        firstProgress = onProgress;
        return firstAll;
      })
      .mockResolvedValue([createSession({ id: "replacement", path: "/tmp/replacement.jsonl" })]);
    const options = createOptions({
      currentLoader: vi.fn().mockResolvedValue(currentSessions),
      allLoader,
    });
    const component = new CheckpointSelectorComponent(options);
    await flush();

    await (component as any).loadScope("all", "toggle").catch(() => undefined);
    expect((component as any).filteredSessions).not.toHaveLength(0);

    (component as any).scope = "all";
    const pending = (component as any).loadScope("all", "toggle");
    const newer = (component as any).loadScope("all", "toggle");
    firstProgress?.(1, 2);
    resolveFirstAll([createSession({ id: "stale", path: "/tmp/stale.jsonl" })]);
    await Promise.allSettled([pending, newer]);
    await flush();

    expect(
      (component as any).filteredSessions.some(
        (entry: { session: CheckpointSelectorSession }) => entry.session.id === "stale",
      ),
    ).toBe(false);
  });

  test("covers platform, empty-state, and direct helper edge cases", async () => {
    const options = createOptions({
      currentLoader: vi.fn().mockRejectedValueOnce("load failed"),
    });
    const component = new CheckpointSelectorComponent(options);
    await flush();

    expect((component as any).header.render(120).join("\n")).toContain(
      "Failed to load sessions: load failed",
    );

    const header = (component as any).header;
    header.setStatusMessage(null);
    header.setScope("all");
    header.setSortMode("recent");
    header.setNameFilter("named");
    header.setShowPath(true);
    expect(header.render(120).join("\n")).toContain("Checkpoint (All)");
    expect(header.render(120).join("\n")).toContain("Recent");
    header.setSortMode("relevance");
    expect(header.render(120).join("\n")).toContain("Fuzzy");
    expect(header.render(120).join("\n")).toContain("Named");
    expect(header.render(120).join("\n")).toContain("path (on)");

    (component as any).currentSessions = null;
    (component as any).allSessions = null;
    (component as any).setVisibleSessionsForScope("all");
    expect((component as any).filteredSessions).toEqual([]);

    (component as any).filteredSessions = [];
    (component as any).startDeleteConfirmation();
    await (component as any).confirmDelete();

    const named = createSession({
      id: "named",
      name: "   ",
      firstMessage: "   ",
      path: "/tmp/named.jsonl",
      sourceSessionFile: undefined,
      checkpointRepoDir: "/tmp/named-repo",
    });
    expect((component as any).toNoCheckpointSession(named).firstMessage).toBe("Untitled session");

    const searchInput = (component as any).searchInput;
    searchInput.onSubmit?.();
    (component as any).filteredSessions = [
      {
        session: createSession({ id: "selected", path: "/tmp/selected.jsonl" }),
        depth: 0,
        isLast: true,
        ancestorContinues: [],
      },
    ];
    searchInput.onSubmit?.();
    expect(options.onClose).toHaveBeenCalled();

    searchInput.setValue("re:");
    (component as any).refilter();
    expect((component as any).filteredSessions).toEqual([]);

    (component as any).confirmingDeletePath = "/tmp/confirming.jsonl";
    const line = (component as any).renderSessionLine(
      {
        session: createSession({
          id: "confirming",
          path: "/tmp/confirming.jsonl",
          firstMessage: "text",
          cwd: "/tmp/project",
          modified: new Date("2026-06-22T11:00:00.000Z"),
        }),
        depth: 2,
        isLast: false,
        ancestorContinues: [true, false],
      },
      false,
      160,
    );
    expect(line).toContain("├─");
    const lastLine = (component as any).renderSessionLine(
      {
        session: createSession({
          id: "last",
          path: "/tmp/last.jsonl",
          firstMessage: "text",
          cwd: "/tmp/project",
          modified: new Date("2026-06-22T11:00:00.000Z"),
        }),
        depth: 1,
        isLast: true,
        ancestorContinues: [false],
      },
      false,
      160,
    );
    expect(lastLine).toContain("└─");
  });

  test("exposes helper functions for direct edge-case coverage", () => {
    const platformSpy = vi.spyOn(process, "platform", "get");
    platformSpy.mockReturnValue("linux");
    expect(__checkpointSelectorTestOnly.normalizeComparablePath("A\\B")).toBe("A/B");
    platformSpy.mockReturnValue("win32");
    expect(__checkpointSelectorTestOnly.normalizeComparablePath("A\\B")).toBe("a/b");
    expect(__checkpointSelectorTestOnly.normalizeTitle(undefined)).toBe("Untitled session");
    expect(
      __checkpointSelectorTestOnly.matchSession(
        createSession({ id: "regex-empty", path: "/tmp/regex-empty.jsonl", firstMessage: "hello" }),
        { mode: "regex", tokens: [], regex: null },
      ),
    ).toEqual({ matches: false, score: 0 });

    const originalCodePointAt = String.prototype.codePointAt;
    String.prototype.codePointAt = vi.fn().mockReturnValue(undefined);
    expect(__checkpointSelectorTestOnly.stripControlCharacters("x")).toBe(" ");
    String.prototype.codePointAt = originalCodePointAt;

    const OriginalRegExp = RegExp;
    vi.stubGlobal(
      "RegExp",
      class BrokenRegExp extends OriginalRegExp {
        constructor(pattern: string | RegExp, flags?: string) {
          if (String(pattern) === "boom") throw "regex fail";
          super(pattern, flags);
        }
      },
    );
    expect(__checkpointSelectorTestOnly.parseSearchQuery("re:boom")).toMatchObject({
      error: "regex fail",
    });
    vi.unstubAllGlobals();

    const emptyPathSessions = [createSession({ id: "empty", path: "", firstMessage: "x" })];
    expect(__checkpointSelectorTestOnly.buildSessionTree(emptyPathSessions)).toHaveLength(1);

    const originalMapGet = Map.prototype.get;
    const mapGet = vi.spyOn(Map.prototype, "get").mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ): unknown {
      if (key === "/tmp/missing-node.jsonl") return undefined;
      return originalMapGet.call(this, key);
    });
    expect(
      __checkpointSelectorTestOnly.buildSessionTree([
        createSession({ id: "missing-node", path: "/tmp/missing-node.jsonl" }),
      ]),
    ).toEqual([]);
    mapGet.mockRestore();

    expect(__checkpointSelectorTestOnly.shortenPathForDisplay("/opt/outside")).toBe("/opt/outside");
    expect(
      __checkpointSelectorTestOnly.filterAndSortSessions(emptyPathSessions, "", "recent", "named"),
    ).toEqual([]);
    expect(
      __checkpointSelectorTestOnly.matchSession(
        createSession({ id: "tokenless", path: "/tmp/tokenless.jsonl", firstMessage: "hello" }),
        __checkpointSelectorTestOnly.parseSearchQuery("   "),
      ),
    ).toEqual({ matches: true, score: 0 });

    const tied = __checkpointSelectorTestOnly.filterAndSortSessions(
      [
        createSession({
          id: "older",
          path: "/tmp/older.jsonl",
          firstMessage: "abc",
          modified: new Date("2026-06-21T00:00:00.000Z"),
        }),
        createSession({
          id: "newer",
          path: "/tmp/newer.jsonl",
          firstMessage: "abc",
          modified: new Date("2026-06-22T00:00:00.000Z"),
        }),
      ],
      "abc",
      "relevance",
      "all",
    );
    expect(tied[0]?.id).toBe("newer");

    const ranked = __checkpointSelectorTestOnly.filterAndSortSessions(
      [
        createSession({
          id: "same",
          path: "/tmp/same.jsonl",
          firstMessage: "zzab",
          modified: new Date("2026-06-22T00:00:00.000Z"),
        }),
        createSession({
          id: "same",
          path: "/tmp/same.jsonl",
          firstMessage: "ab",
          modified: new Date("2026-06-21T00:00:00.000Z"),
        }),
      ],
      "ab",
      "relevance",
      "all",
    );
    expect(ranked[0]?.firstMessage).toBe("ab");

    const roots = __checkpointSelectorTestOnly.buildSessionTree([
      createSession({ id: "root", path: "/tmp/root.jsonl", firstMessage: "root" }),
      createSession({
        id: "child-1",
        path: "/tmp/child-1.jsonl",
        parentSessionPath: "/tmp/root.jsonl",
        firstMessage: "child-1",
      }),
      createSession({
        id: "child-2",
        path: "/tmp/child-2.jsonl",
        parentSessionPath: "/tmp/root.jsonl",
        firstMessage: "child-2",
      }),
      createSession({
        id: "grand",
        path: "/tmp/grand.jsonl",
        parentSessionPath: "/tmp/child-1.jsonl",
        firstMessage: "grand",
      }),
    ]);
    const flattened = __checkpointSelectorTestOnly.flattenSessionTree(roots);
    expect(flattened[2]?.ancestorContinues).toEqual([false, true]);
  });

  test("surfaces string refresh failures after delete success", async () => {
    const session = createSession({
      id: "session",
      path: "/tmp/session.jsonl",
      checkpointRepoDir: "/tmp/session-repo",
      sourceSessionFile: "/tmp/session.jsonl",
      firstMessage: "Delete me",
    });
    const component = new CheckpointSelectorComponent(
      createOptions({
        currentLoader: vi.fn().mockResolvedValue([session]),
        allLoader: vi.fn().mockRejectedValue("refresh failed"),
        deleteStorage: vi.fn().mockResolvedValue({ ok: true }),
      }),
    );
    await flush();

    (component as any).currentSessions = [session];
    (component as any).allSessions = [session];
    (component as any).filteredSessions = [
      { session, depth: 0, isLast: true, ancestorContinues: [] },
    ];
    await (component as any).confirmDelete();
    await flush();
    await flush();
    expect((component as any).header.render(120).join("\n")).toContain(
      "Checkpoint list refresh failed: refresh failed",
    );
  });

  test("surfaces thrown delete failures in the header", async () => {
    const session = createSession({
      id: "session-throw",
      path: "/tmp/session-throw.jsonl",
      checkpointRepoDir: "/tmp/session-throw-repo",
      sourceSessionFile: "/tmp/session-throw.jsonl",
      firstMessage: "Delete me",
    });
    const component = new CheckpointSelectorComponent(
      createOptions({
        currentLoader: vi.fn().mockResolvedValue([session]),
        allLoader: vi.fn().mockResolvedValue([session]),
        deleteStorage: vi.fn().mockRejectedValue(new Error("kaboom")),
      }),
    );
    await flush();

    (component as any).currentSessions = [session];
    (component as any).allSessions = [session];
    (component as any).filteredSessions = [
      { session, depth: 0, isLast: true, ancestorContinues: [] },
    ];
    await (component as any).confirmDelete();
    await flush();
    expect((component as any).header.render(120).join("\n")).toContain(
      "Checkpoint storage delete failed: kaboom",
    );
  });

  test("cancels delete confirmation and triggers uncached all-scope loading", async () => {
    let progress: ((loaded: number, total: number) => void) | undefined;
    const allLoader = vi.fn((onProgress?: (loaded: number, total: number) => void) => {
      progress = onProgress;
      return Promise.resolve([createSession({ id: "all", path: "/tmp/all.jsonl" })]);
    });
    const component = new CheckpointSelectorComponent(
      createOptions({
        currentLoader: vi
          .fn()
          .mockResolvedValue([createSession({ id: "current", path: "/tmp/current.jsonl" })]),
        allLoader,
      }),
    );
    await flush();

    (component as any).confirmingDeletePath = "/tmp/current.jsonl";
    (component as any).header.setConfirmingDelete("storage");
    component.handleInput("other");
    expect((component as any).confirmingDeletePath).toBe("/tmp/current.jsonl");
    component.handleInput("escape");
    expect((component as any).confirmingDeletePath).toBeNull();

    (component as any).allSessions = null;
    (component as any).allLoading = false;
    (component as any).toggleScope();
    (component as any).scope = "current";
    progress?.(1, 2);
    await flush();
    expect(allLoader).toHaveBeenCalled();

    const alreadyLoading = new CheckpointSelectorComponent(
      createOptions({
        currentLoader: vi.fn().mockResolvedValue([]),
        allLoader: vi.fn().mockResolvedValue([]),
      }),
    );
    await flush();
    const loadSpy = vi.spyOn(alreadyLoading as never, "loadScope");
    (alreadyLoading as any).allSessions = null;
    (alreadyLoading as any).allLoading = true;
    (alreadyLoading as any).toggleScope();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  test("returns early when load failures are for a different scope or stale sequence", async () => {
    let rejectFirst!: (error: unknown) => void;
    const first = new Promise<CheckpointSelectorSession[]>((_, reject) => {
      rejectFirst = reject;
    });
    const visibleAllLoader = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new Error("visible failure"));
    const component = new CheckpointSelectorComponent(
      createOptions({
        currentLoader: vi
          .fn()
          .mockResolvedValue([createSession({ id: "current", path: "/tmp/current.jsonl" })]),
        allLoader: visibleAllLoader,
      }),
    );
    await flush();

    (component as any).scope = "current";
    const hiddenFailure = (component as any).loadScope("all", "toggle");
    rejectFirst(new Error("stale hidden"));
    await Promise.allSettled([hiddenFailure]);

    (component as any).scope = "all";
    await (component as any).loadScope("all", "toggle").catch(() => undefined);
    expect((component as any).header.render(120).join("\n")).toContain("visible failure");

    let rejectStale!: (error: unknown) => void;
    const stale = new Promise<CheckpointSelectorSession[]>((_, reject) => {
      rejectStale = reject;
    });
    (component as any).allLoadSeq = 0;
    const staleLoader = vi
      .fn()
      .mockReturnValueOnce(stale)
      .mockResolvedValue([createSession({ id: "fresh", path: "/tmp/fresh.jsonl" })]);
    (component as any).options.allLoader = staleLoader;
    (component as any).scope = "all";
    const firstAttempt = (component as any).loadScope("all", "toggle");
    const secondAttempt = (component as any).loadScope("all", "toggle");
    rejectStale(new Error("stale failure"));
    await Promise.allSettled([firstAttempt, secondAttempt]);
    await flush();
    expect((component as any).allSessions?.[0]?.id).toBe("fresh");
  });
});
