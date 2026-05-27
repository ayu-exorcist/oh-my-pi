import { describe, expect, test, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import ayu, {
  buildWriteModeOffPrompt,
  buildWriteModeOnPrompt,
  createWriteModeEditorFactory,
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
  readonly sendUserMessage: ReturnType<typeof vi.fn>;
} {
  const events: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const commands = new Map<string, RegisteredCommand>();
  const shortcuts = new Map<string, RegisteredShortcut>();
  const sendUserMessage = vi.fn();

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
    sendUserMessage,
  } as unknown as ExtensionAPI;

  return { api, events, commands, shortcuts, sendUserMessage };
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

function createContext(options?: { readonly idle?: boolean; readonly hasUI?: boolean }) {
  return {
    isIdle: () => options?.idle ?? true,
    hasUI: options?.hasUI ?? true,
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

describe("Ayu extension", () => {
  test("creates write mode editor factory", () => {
    const state = { writeEnabled: true, activeTui: undefined };
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

  test("registers command, shortcut, and session editor hooks", async () => {
    const { api, events, commands, shortcuts } = createMockApi();
    ayu(api);

    expect(commands.has("ayu")).toBe(true);
    expect(shortcuts.has("alt+s")).toBe(true);
    expect(events.session_start?.length).toBe(1);
    expect(events.session_tree?.length).toBe(1);
    expect(events.session_shutdown?.length).toBe(1);
    expect(events.before_agent_start?.length).toBe(1);
    expect(events.agent_end?.length).toBe(1);
    expect(events.tool_call?.length).toBe(1);

    const ctx = createContext();
    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalled();
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("ayu-write-mode", undefined);

    await runHandlers(events, "session_tree", {}, ctx);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(2);

    await runHandlers(events, "session_shutdown", {}, ctx);

    await runHandlers(events, "session_start", { reason: "new" }, ctx);
    await getCommand(commands, "ayu").handler("on", ctx);
    await runHandlers(events, "session_start", { reason: "reload" }, ctx);
    await getCommand(commands, "ayu").handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: Off", "info");
  });

  test("shows help, status, and settings deprecation messages", async () => {
    const { api, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();

    await command.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Ayu workflow"), "info");

    await command.handler("help", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Write Mode"), "info");

    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: Off", "info");

    await command.handler("settings", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Ayu settings were removed. Use Alt+S or /ayu [write] on|off to control session Write Mode.",
      "warning",
    );
  });

  test("toggles write mode through command and shortcut", async () => {
    const { api, commands, shortcuts } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const shortcut = getShortcut(shortcuts, "alt+s");
    const ctx = createContext();

    await command.handler("on", ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: On", "info");

    await command.handler("off trailing prompt", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Ayu: Write Mode Off. Ignored trailing prompt after off.",
      "warning",
    );

    await shortcut.handler(ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: On", "info");

    await command.handler("write off", ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: Off", "info");
  });

  test("sends prompts immediately or as follow-up", async () => {
    const { api, commands, sendUserMessage } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");

    const idleCtx = createContext({ idle: true });
    await command.handler("task add tests", idleCtx);
    expect(sendUserMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Task input:\nadd tests"),
    );

    await command.handler("write on implement now", idleCtx);
    expect(sendUserMessage).toHaveBeenLastCalledWith("implement now");

    const busyCtx = createContext({ idle: false });
    await command.handler("review docs", busyCtx);
    expect(sendUserMessage).toHaveBeenLastCalledWith(expect.stringContaining("Focus: docs"), {
      deliverAs: "followUp",
    });
    expect(busyCtx.ui.notify).toHaveBeenLastCalledWith("Ayu command queued as follow-up.", "info");
  });

  test("warns on unknown command", async () => {
    const { api, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();

    await command.handler("missing", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Ayu workflow"),
      "warning",
    );
  });

  test("builds explicit Write Mode prompts", () => {
    const offPrompt = buildWriteModeOffPrompt();
    expect(offPrompt).toContain("Ayu Write Mode is Off for this session.");
    expect(offPrompt).toContain("discussion, planning, review, and read-only inspection mode");
    expect(offPrompt).toContain("reproduce → minimise → hypothesise");
    expect(offPrompt).toContain("Ask the user to enable Write Mode");

    const onPrompt = buildWriteModeOnPrompt();
    expect(onPrompt).toContain("Ayu Write Mode is On for this session.");
    expect(onPrompt).toContain("implementation mode for small, verified changes");
    expect(onPrompt).toContain("Implement the smallest vertical slice");
    expect(onPrompt).toContain("Verify with exact commands and report evidence");
  });

  test("injects explicit mode prompt for both Write Mode states", async () => {
    const { api, events, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();

    let results = await runHandlers(events, "before_agent_start", { systemPrompt: "base" }, ctx);
    expect(results[0]).toEqual({
      systemPrompt: expect.stringContaining("Ayu Write Mode is Off for this session."),
    });

    await command.handler("on", ctx);
    results = await runHandlers(events, "before_agent_start", { systemPrompt: "base" }, ctx);
    expect(results[0]).toEqual({
      systemPrompt: expect.stringContaining("Ayu Write Mode is On for this session."),
    });
  });

  test("auto-turns Write Mode Off after /ayu on prompt finishes", async () => {
    const { api, events, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();

    await command.handler("on implement once", ctx);
    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: On", "info");

    const promptResults = await runHandlers(
      events,
      "before_agent_start",
      { systemPrompt: "base" },
      ctx,
    );
    expect(promptResults[0]).toEqual({
      systemPrompt: expect.stringContaining("Ayu Write Mode is On for this session."),
    });

    await runHandlers(events, "agent_end", { messages: [] }, ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Ayu Write Mode automatically turned Off after one-shot prompt.",
      "info",
    );

    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: Off", "info");
  });

  test("keeps manual Write Mode On after agent end", async () => {
    const { api, events, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();

    await command.handler("on", ctx);
    await runHandlers(events, "before_agent_start", { systemPrompt: "base" }, ctx);
    await runHandlers(events, "agent_end", { messages: [] }, ctx);
    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Ayu Write Mode: On", "info");
  });

  test("blocks mutating tool calls while locked and allows them while enabled", async () => {
    const { api, events, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
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

  test("blocks without notifying when UI is unavailable", async () => {
    const { api, events } = createMockApi();
    ayu(api);
    const ctx = createContext({ hasUI: false });

    const results = await runHandlers(events, "tool_call", { toolName: "write", input: {} }, ctx);
    expect(results[0]).toEqual({
      block: true,
      reason: expect.stringContaining("Ayu write gate blocked write while locked."),
    });
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});
