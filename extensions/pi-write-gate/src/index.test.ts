import { describe, expect, test, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
  };
});

import { readFile } from "node:fs/promises";
import writeGate, {
  buildWriteModeOffPrompt,
  buildWriteModeOnPrompt,
  createWriteModeEditorFactory,
  handleGateCommand,
  parseGateCommandArgs,
} from "./index";
import {
  KeybindingsManager as TuiKeybindingsManager,
  TUI,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

interface RegisteredCommand {
  readonly description?: string;
  readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

interface RegisteredShortcut {
  readonly description?: string;
  readonly handler: (ctx: ExtensionContext) => Promise<void> | void;
}

function createMockApi(): {
  readonly api: ExtensionAPI;
  readonly events: Record<string, Array<(...args: unknown[]) => unknown>>;
  readonly commands: Map<string, RegisteredCommand>;
  readonly shortcuts: Map<string, RegisteredShortcut>;
  readonly appendEntry: ReturnType<typeof vi.fn>;
} {
  const events: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const commands = new Map<string, RegisteredCommand>();
  const shortcuts = new Map<string, RegisteredShortcut>();
  const appendEntry = vi.fn();

  const api = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      events[event] = events[event] || [];
      events[event].push(handler);
    },
    registerCommand: (name: string, options: RegisteredCommand) => {
      commands.set(name, options);
    },
    registerShortcut: (shortcut: string, options: RegisteredShortcut) => {
      shortcuts.set(shortcut, options);
    },
    appendEntry,
  } as unknown as ExtensionAPI;

  return { api, events, commands, shortcuts, appendEntry };
}

function createTui(): TUI {
  return new TUI({
    start: vi.fn(),
    stop: vi.fn(),
    drainInput: vi.fn().mockResolvedValue(undefined),
    write: vi.fn(),
    columns: 80,
    rows: 24,
    kittyProtocolActive: false,
    moveBy: vi.fn(),
    hideCursor: vi.fn(),
    showCursor: vi.fn(),
    clearLine: vi.fn(),
    clearFromCursor: vi.fn(),
    clearScreen: vi.fn(),
    setTitle: vi.fn(),
    setProgress: vi.fn(),
  });
}

function createEditorTheme(): EditorTheme {
  return {
    borderColor: (text: string) => text,
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  };
}

function createContext(options?: {
  readonly idle?: boolean;
  readonly hasUI?: boolean;
  readonly entries?: unknown[];
  readonly cwd?: string;
}) {
  return {
    isIdle: () => options?.idle ?? true,
    hasUI: options?.hasUI ?? true,
    cwd: options?.cwd ?? "/mock/project",
    sessionManager: {
      getEntries: () => options?.entries ?? [],
    },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setEditorComponent: vi.fn(),
      theme: { fg: vi.fn((_color: string, text: string) => text) },
    },
  } as unknown as ExtensionCommandContext;
}

function getCommand(
  commands: ReadonlyMap<string, RegisteredCommand>,
  name: string,
): RegisteredCommand {
  const command = commands.get(name);
  if (!command) throw new Error(`missing command ${name}`);
  return command;
}

function getShortcut(
  shortcuts: ReadonlyMap<string, RegisteredShortcut>,
  name: string,
): RegisteredShortcut {
  const shortcut = shortcuts.get(name);
  if (!shortcut) throw new Error(`missing shortcut ${name}`);
  return shortcut;
}

async function runHandlers(
  events: Readonly<Record<string, Array<(...args: unknown[]) => unknown>>>,
  eventName: string,
  event: unknown,
  ctx: unknown,
): Promise<unknown[]> {
  const handlers = events[eventName] ?? [];
  const results: unknown[] = [];
  for (const handler of handlers) {
    results.push(await handler(event, ctx));
  }
  return results;
}

describe("Write Gate extension", () => {
  test("parses gate command arguments", () => {
    expect(parseGateCommandArgs("")).toEqual({
      action: "help",
      ignoredTrailingPrompt: false,
    });
    expect(parseGateCommandArgs("write on implement now")).toEqual({
      action: "on",
      ignoredTrailingPrompt: true,
    });
    expect(parseGateCommandArgs("off trailing prompt")).toEqual({
      action: "off",
      ignoredTrailingPrompt: true,
    });
    expect(parseGateCommandArgs("status")).toEqual({
      action: "status",
      ignoredTrailingPrompt: false,
    });
    expect(parseGateCommandArgs("task add tests")).toEqual({
      action: "unknown",
      ignoredTrailingPrompt: false,
    });
    expect(parseGateCommandArgs("auto")).toEqual({
      action: "auto",
      ignoredTrailingPrompt: false,
    });
    expect(parseGateCommandArgs("write auto extra prompt")).toEqual({
      action: "auto",
      ignoredTrailingPrompt: true,
    });
  });

  test("creates write mode editor factory", () => {
    const state = { mode: "on" as const, activeTui: undefined };
    const ctx = createContext();
    const tui = createTui();
    const editor = createWriteModeEditorFactory(state, ctx)(
      tui,
      createEditorTheme(),
      new TuiKeybindingsManager(TUI_KEYBINDINGS) as KeybindingsManager,
    );

    expect(editor.render(40)[0]).toContain(" Write Mode: On ");
    expect(state.activeTui).toBe(tui);
  });

  test("registers commands, shortcut, and session editor hooks", async () => {
    const { api, events, commands, shortcuts } = createMockApi();
    writeGate(api);

    expect(commands.has("write-gate")).toBe(true);
    expect(commands.has("ayu")).toBe(false);
    expect(shortcuts.has("alt+s")).toBe(true);
    expect(events.session_start?.length).toBe(1);
    expect(events.session_tree?.length).toBe(1);
    expect(events.session_shutdown?.length).toBe(1);
    expect(events.before_agent_start?.length).toBe(1);
    expect(events.agent_end).toBeUndefined();
    expect(events.tool_call?.length).toBe(1);

    const ctx = createContext();
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalled();
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("write-gate-mode", undefined);

    await runHandlers(events, "session_tree", {}, ctx);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(2);

    await runHandlers(events, "session_shutdown", {}, ctx);

    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    await getCommand(commands, "write-gate").handler("on", ctx);
    await getCommand(commands, "write-gate").handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: On", "info");

    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    await getCommand(commands, "write-gate").handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: Off", "info");
  });

  test("shows help and status", async () => {
    const { api, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    await command.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Write Gate"), "info");

    await command.handler("help", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Write Mode"), "info");

    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: Off", "info");
  });

  test("toggles write mode through commands and shortcut", async () => {
    const { api, commands, shortcuts } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const shortcut = getShortcut(shortcuts, "alt+s");
    const ctx = createContext();

    await command.handler("on", ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: On", "info");

    await command.handler("off trailing prompt", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Write Gate: Write Mode Off. Ignored trailing prompt after off.",
      "warning",
    );

    await shortcut.handler(ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: On", "info");

    await command.handler("write off", ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: Off", "info");
  });

  test("does not send trailing prompts through write-gate", async () => {
    const { api, commands, appendEntry } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    await command.handler("write on implement now", ctx);

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-write-gate.state",
      expect.objectContaining({ mode: "on", source: "command" }),
    );
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Write Gate: Write Mode On. Ignored trailing prompt; send it as your next message.",
      "warning",
    );
  });

  test("builds explicit Write Mode prompts", () => {
    const offPrompt = buildWriteModeOffPrompt();
    expect(offPrompt).toContain("Write authorization is Off for this session.");
    expect(offPrompt).toContain("discussion, planning, review, and read-only inspection mode");
    expect(offPrompt).toContain("reproduce → minimise → hypothesise");
    expect(offPrompt).toContain("Ask the user to enable Write Mode");

    const onPrompt = buildWriteModeOnPrompt();
    expect(onPrompt).toContain("Write authorization is On for this session.");
    expect(onPrompt).toContain("implementation mode for small, verified changes");
    expect(onPrompt).toContain("Implement the smallest vertical slice");
    expect(onPrompt).toContain("Verify with exact commands and report evidence");
  });

  test("injects explicit mode prompt for both Write Mode states", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    let results = await runHandlers(events, "before_agent_start", { systemPrompt: "base" }, ctx);
    expect(results[0]).toEqual({
      systemPrompt: expect.stringContaining("Write authorization is Off for this session."),
    });

    await command.handler("on", ctx);
    results = await runHandlers(events, "before_agent_start", { systemPrompt: "base" }, ctx);
    expect(results[0]).toEqual({
      systemPrompt: expect.stringContaining("Write authorization is On for this session."),
    });
  });

  test("keeps Write Mode On after agent turns", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    await command.handler("on", ctx);
    await runHandlers(events, "before_agent_start", { systemPrompt: "base" }, ctx);
    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Write Mode: On", "info");
  });

  test("blocks mutating tool calls while locked and allows them while enabled", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    let results = await runHandlers(events, "tool_call", { toolName: "edit", input: {} }, ctx);
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Ayu write gate blocked edit while locked."),
    });
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Ayu write gate blocked edit while locked."),
      "warning",
    );

    results = await runHandlers(
      events,
      "tool_call",
      { toolName: "bash", input: { command: "git status --short" } },
      ctx,
    );
    expect(results[0]).toBeUndefined();

    await command.handler("on", ctx);
    results = await runHandlers(events, "tool_call", { toolName: "edit", input: {} }, ctx);
    expect(results[0]).toBeUndefined();
  });

  test("blocks T4 bash commands even when Write Mode is On", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    await command.handler("on", ctx);

    let results = await runHandlers(
      events,
      "tool_call",
      { toolName: "bash", input: { command: "git push origin main" } },
      ctx,
    );
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Blocked T4"),
    });

    results = await runHandlers(
      events,
      "tool_call",
      { toolName: "bash", input: { command: "rm -rf node_modules" } },
      ctx,
    );
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Blocked T3"),
    });
  });

  test("blocks T4 without notifying when UI is unavailable and Write Mode is On", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext({ hasUI: false });

    await command.handler("on", ctx);

    const results = await runHandlers(
      events,
      "tool_call",
      { toolName: "bash", input: { command: "git push" } },
      ctx,
    );
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Blocked T4"),
    });
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  test("blocks without notifying when UI is unavailable", async () => {
    const { api, events } = createMockApi();
    writeGate(api);
    const ctx = createContext({ hasUI: false });

    const results = await runHandlers(events, "tool_call", { toolName: "write", input: {} }, ctx);
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Ayu write gate blocked write while locked."),
    });
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  test("allows non-mutating tools when Write Mode is On", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);
    const command = getCommand(commands, "write-gate");
    const ctx = createContext();

    await command.handler("on", ctx);
    const results = await runHandlers(
      events,
      "tool_call",
      { toolName: "read_file", input: { path: "test.ts" } },
      ctx,
    );
    expect(results[0]).toBeUndefined();
  });

  test("restores write mode on session resume", async () => {
    const { api, events, commands, appendEntry } = createMockApi();
    writeGate(api);

    // First turn on write mode
    const ctx1 = createContext();
    await getCommand(commands, "write-gate").handler("on", ctx1);
    expect(appendEntry).toHaveBeenCalledWith(
      "pi-write-gate.state",
      expect.objectContaining({ mode: "on" }),
    );

    // Simulate resume with persisted state
    const ctx2 = createContext({
      entries: [
        {
          type: "custom",
          customType: "pi-write-gate.state",
          data: { mode: "on", source: "command", timestamp: new Date().toISOString() },
        },
      ],
    });
    await runHandlers(events, "session_start", { reason: "resume" }, ctx2);
    expect(ctx2.ui.notify).toHaveBeenCalledWith("Write Mode restored: On", "info");
  });

  test("restores auto mode on session resume", async () => {
    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({
      entries: [
        {
          type: "custom",
          customType: "pi-write-gate.state",
          data: { mode: "auto", source: "command", timestamp: new Date().toISOString() },
        },
      ],
    });
    await runHandlers(events, "session_start", { reason: "resume" }, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Write Mode restored: Auto", "info");
  });

  test("auto mode allows safe tools", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);

    // Switch to auto mode
    await getCommand(commands, "write-gate").handler("auto", createContext());

    const ctx = createContext();
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    await getCommand(commands, "write-gate").handler("auto", ctx);

    const results = await runHandlers(
      events,
      "tool_call",
      { toolName: "write", input: { path: "test.ts" } },
      ctx,
    );
    expect(results[0]).toBeUndefined();
  });

  test("auto mode blocks risky tools and records auto block", async () => {
    const { api, events, commands } = createMockApi();
    writeGate(api);

    const ctx = createContext();
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    await getCommand(commands, "write-gate").handler("auto", ctx);

    // Block risky tool 3 times to trigger auto fallback
    for (let i = 0; i < 3; i++) {
      const results = await runHandlers(
        events,
        "tool_call",
        { toolName: "bash", input: { command: "git push origin main" } },
        ctx,
      );
      if (i < 2) {
        expect(results[0]).toEqual({
          block: true,
          reason: expect.stringContaining("Blocked T4"),
        });
      }
    }

    // After 3 consecutive blocks, auto mode should fall back to on
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Auto Mode paused after repeated blocks"),
      "warning",
    );
  });

  test("loads classifier approver from settings", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          approver: "classifier",
        },
      }),
    );

    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    // Should not throw with classifier approver
  });

  test("loads risk rules from settings.json", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          riskRules: [{ pattern: "git push", tier: "T4" }],
        },
      }),
    );

    const { api, events, commands } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);

    // With risk rules loaded, T4 commands should still be blocked in Write Mode On
    await getCommand(commands, "write-gate").handler("on", ctx);
    const results = await runHandlers(
      events,
      "tool_call",
      { toolName: "bash", input: { command: "git push origin main" } },
      ctx,
    );
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Blocked T4"),
    });
  });

  test("handles malformed settings.json gracefully", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));

    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    // Should not throw
  });

  test("skips non-record parsed settings", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify("not an object"));

    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    // Should not throw
  });

  test("skips settings without writeGate record", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ writeGate: "string" }));

    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    // Should not throw
  });

  test("skips settings with non-array riskRules", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ writeGate: { riskRules: "not-array" } }),
    );

    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    // Should not throw
  });

  test("skips empty riskRules array", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ writeGate: { riskRules: [] } }));

    const { api, events } = createMockApi();
    writeGate(api);

    const ctx = createContext({ cwd: "/test/project" });
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    // Should not throw
  });
});

describe("handleGateCommand", () => {
  function createMockPi() {
    return {
      appendEntry: vi.fn(),
      sendUserMessage: vi.fn(),
    } as unknown as ExtensionAPI;
  }

  function createMockState(mode: "off" | "on" | "auto" = "off") {
    return { mode, activeTui: undefined };
  }

  test("handles help action", async () => {
    const pi = createMockPi();
    const state = createMockState();
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "", ctx);
    expect(result).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Write Gate"), "info");
  });

  test("handles on action", async () => {
    const pi = createMockPi();
    const state = createMockState();
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "on", ctx);
    expect(result).toBe(true);
    expect(state.mode).toBe("on");
    expect(pi.appendEntry).toHaveBeenCalled();
  });

  test("handles off action", async () => {
    const pi = createMockPi();
    const state = createMockState("on");
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "off", ctx);
    expect(result).toBe(true);
    expect(state.mode).toBe("off");
    expect(pi.appendEntry).toHaveBeenCalled();
  });

  test("handles status action", async () => {
    const pi = createMockPi();
    const state = createMockState("on");
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "status", ctx);
    expect(result).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Write Mode: On", "info");
  });

  test("handles auto action", async () => {
    const pi = createMockPi();
    const state = createMockState();
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "auto", ctx);
    expect(result).toBe(true);
    expect(state.mode).toBe("auto");
    expect(pi.appendEntry).toHaveBeenCalled();
  });

  test("warns on trailing prompt after auto", async () => {
    const pi = createMockPi();
    const state = createMockState();
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "auto extra prompt", ctx);
    expect(result).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Write Gate: Auto Mode enabled. Ignored trailing prompt; send it as your next message.",
      "warning",
    );
  });

  test("shows auto status", async () => {
    const pi = createMockPi();
    const state = createMockState("auto");
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "status", ctx);
    expect(result).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Write Mode: Auto", "info");
  });

  test("handles unknown action", async () => {
    const pi = createMockPi();
    const state = createMockState();
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "unknown", ctx);
    expect(result).toBe(false);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Write Gate"), "warning");
  });

  test("warns on trailing prompt after on", async () => {
    const pi = createMockPi();
    const state = createMockState();
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "on extra prompt", ctx);
    expect(result).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Write Gate: Write Mode On. Ignored trailing prompt; send it as your next message.",
      "warning",
    );
  });

  test("warns on trailing prompt after off", async () => {
    const pi = createMockPi();
    const state = createMockState("on");
    const ctx = createContext();
    const result = await handleGateCommand(pi, state, "off extra prompt", ctx);
    expect(result).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Write Gate: Write Mode Off. Ignored trailing prompt after off.",
      "warning",
    );
  });
});
