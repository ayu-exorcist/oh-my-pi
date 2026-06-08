import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import compactExtension from "./index";

interface RegisteredTool {
  readonly name: string;
  readonly renderCall: (
    args: Record<string, unknown>,
    theme: Pick<Theme, "fg" | "bold">,
  ) => unknown;
  readonly renderResult: (
    result: { content: Array<{ type: string; text?: string }> },
    options: { expanded?: boolean },
    theme: Pick<Theme, "fg">,
  ) => unknown;
}

interface RegisteredCommand {
  readonly handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
}

function createMockApi() {
  const tools = new Map<string, RegisteredTool>();
  const commands = new Map<string, RegisteredCommand>();
  const events: Record<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>> = {};
  const appendEntry = vi.fn();
  const api = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      events[event] = events[event] || [];
      events[event]!.push(handler);
    },
    appendEntry,
  } as unknown as ExtensionAPI;

  return { api, tools, commands, events, appendEntry };
}

function createCtx(entries: unknown[] = []): ExtensionContext {
  return {
    cwd: process.cwd(),
    ui: { notify: vi.fn() },
    sessionManager: { getEntries: () => entries },
  } as unknown as ExtensionContext;
}

function createTheme(): Pick<Theme, "fg" | "bold"> {
  return {
    fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
    bold: vi.fn((text: string) => `**${text}**`),
  } as unknown as Pick<Theme, "fg" | "bold">;
}

function textResult(text?: string) {
  return { content: text === undefined ? [] : [{ type: "text", text }] };
}

function getTool(tools: ReadonlyMap<string, RegisteredTool>, name: string): RegisteredTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

function getCommand(
  commands: ReadonlyMap<string, RegisteredCommand>,
  name: string,
): RegisteredCommand {
  const command = commands.get(name);
  if (!command) throw new Error(`missing command ${name}`);
  return command;
}

describe("pi-compact extension", () => {
  test("registers compact wrappers and command", () => {
    const { api, tools, commands, events } = createMockApi();
    compactExtension(api);

    expect([...tools.keys()].sort()).toEqual([
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
    ]);
    expect(commands.has("compact")).toBe(true);
    expect(events.session_start).toHaveLength(1);
    expect(events.session_tree).toHaveLength(1);
  });

  test("toggles, reports, persists, and restores compact state", async () => {
    const { api, commands, events, appendEntry } = createMockApi();
    compactExtension(api);
    const command = getCommand(commands, "compact");
    const ctx = createCtx();

    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Compact mode: on", "info");

    await command.handler("off", ctx);
    expect(appendEntry).toHaveBeenLastCalledWith("pi-compact.state", { enabled: false });
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Compact mode: off", "info");

    await command.handler("on", ctx);
    expect(appendEntry).toHaveBeenLastCalledWith("pi-compact.state", { enabled: true });
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Compact mode: on", "info");

    await command.handler("bad", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Usage: /compact on | /compact off | /compact status",
      "warning",
    );

    const restoredCtx = createCtx([
      { type: "custom", customType: "other", data: { enabled: false } },
      { type: "custom", customType: "pi-compact.state", data: { enabled: false } },
      { type: "custom", customType: "pi-compact.state", data: { enabled: "bad" } },
    ]);
    for (const handler of events.session_start ?? []) await handler({}, restoredCtx);
    await command.handler("", restoredCtx);
    expect(restoredCtx.ui.notify).toHaveBeenLastCalledWith("Compact mode: off", "info");

    const treeCtx = createCtx([
      { type: "custom", customType: "pi-compact.state", data: { enabled: true } },
    ]);
    for (const handler of events.session_tree ?? []) await handler({}, treeCtx);
    await command.handler("", treeCtx);
    expect(treeCtx.ui.notify).toHaveBeenLastCalledWith("Compact mode: on", "info");
  });

  test("renders compact read, bash, edit, write, find, grep, and ls summaries", () => {
    const { api, tools } = createMockApi();
    compactExtension(api);
    const theme = createTheme();

    getTool(tools, "read").renderCall({ path: "file.ts", offset: 2, limit: 3 }, theme);
    getTool(tools, "read").renderResult(textResult("a\nb\n"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ 2 lines");

    getTool(tools, "bash").renderCall({ command: "pnpm test", timeout: 5 }, theme);
    getTool(tools, "bash").renderResult(textResult("ok"), {}, theme);
    getTool(tools, "bash").renderResult(textResult("one\ntwo"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ ok");
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ 2 lines");

    getTool(tools, "edit").renderCall({ path: "file.ts" }, theme);
    getTool(tools, "edit").renderResult(textResult("+ added\n- removed"), {}, theme);
    getTool(tools, "edit").renderResult(textResult("Error: bad"), {}, theme);
    getTool(tools, "edit").renderResult(textResult("done"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("toolDiffAdded", "+1 ");
    expect(theme.fg).toHaveBeenCalledWith("toolDiffRemoved", "-1");
    expect(theme.fg).toHaveBeenCalledWith("error", "→ failed");
    expect(theme.fg).toHaveBeenCalledWith("success", "→ edited");

    getTool(tools, "write").renderCall({ path: "file.ts", content: "a\nb" }, theme);
    getTool(tools, "write").renderResult(textResult(), {}, theme);
    getTool(tools, "write").renderResult(textResult("failed"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("success", "→ written");
    expect(theme.fg).toHaveBeenCalledWith("error", "→ failed");

    getTool(tools, "find").renderCall({ pattern: "*.ts", path: "src" }, theme);
    getTool(tools, "find").renderResult(textResult("a.ts\nb.ts"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ 2 files");

    getTool(tools, "grep").renderCall({ pattern: "test", path: "src" }, theme);
    getTool(tools, "grep").renderResult(textResult("a.ts:1\nb.ts:2"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ 2 matches");

    getTool(tools, "ls").renderCall({ path: "src" }, theme);
    getTool(tools, "ls").renderResult(textResult("a\nb"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ 2 entries");
  });

  test("renders empty and expanded results", async () => {
    const { api, tools, commands } = createMockApi();
    compactExtension(api);
    const theme = createTheme();

    getTool(tools, "read").renderResult(textResult("\n"), {}, theme);
    getTool(tools, "bash").renderResult(textResult("\n"), {}, theme);
    getTool(tools, "find").renderResult(textResult("\n"), {}, theme);
    getTool(tools, "grep").renderResult(textResult("\n"), {}, theme);
    getTool(tools, "ls").renderResult(textResult("\n"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("dim", "→ empty");
    expect(theme.fg).toHaveBeenCalledWith("dim", "→ done");
    expect(theme.fg).toHaveBeenCalledWith("dim", "→ none");

    getTool(tools, "read").renderResult(textResult("full\ntext"), { expanded: true }, theme);
    getTool(tools, "edit").renderResult(textResult("full edit"), { expanded: true }, theme);
    getTool(tools, "write").renderResult(textResult("full write"), { expanded: true }, theme);
    getTool(tools, "find").renderResult(textResult("full find"), { expanded: true }, theme);
    getTool(tools, "grep").renderResult(textResult("full grep"), { expanded: true }, theme);
    getTool(tools, "ls").renderResult(textResult("full ls"), { expanded: true }, theme);
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full");
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full edit");
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full write");
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full find");
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full grep");
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full ls");

    const ctx = createCtx();
    await getCommand(commands, "compact").handler("off", ctx);
    getTool(tools, "bash").renderResult(textResult("full output"), {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "full output");
  });

  test("renders fallback call arguments and missing text content", () => {
    const { api, tools } = createMockApi();
    compactExtension(api);
    const theme = createTheme();

    getTool(tools, "read").renderCall(
      { path: join(homedir(), "repo", "file.ts"), limit: 2 },
      theme,
    );
    getTool(tools, "read").renderCall({ path: "file.ts", offset: 3 }, theme);
    getTool(tools, "read").renderCall({}, theme);
    getTool(tools, "read").renderResult({ content: [{ type: "image" }] }, {}, theme);
    getTool(tools, "read").renderResult(
      { content: [{ type: "image" }] },
      { expanded: true },
      theme,
    );
    expect(theme.fg).toHaveBeenCalledWith("warning", ":1-2");
    expect(theme.fg).toHaveBeenCalledWith("warning", ":3");
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", "...");

    getTool(tools, "bash").renderCall({}, theme);
    getTool(tools, "bash").renderCall({ command: "echo ok", timeout: 0 }, theme);
    getTool(tools, "bash").renderResult(
      textResult("this is a single output line longer than forty characters"),
      {},
      theme,
    );
    getTool(tools, "bash").renderResult({ content: [{ type: "image" }] }, {}, theme);
    expect(theme.bold).toHaveBeenCalledWith("$ ...");
    expect(theme.fg).toHaveBeenCalledWith("muted", "→ 1 lines");

    getTool(tools, "edit").renderCall({}, theme);
    getTool(tools, "edit").renderResult({ content: [{ type: "image" }] }, {}, theme);
    getTool(tools, "write").renderCall({}, theme);
    getTool(tools, "write").renderResult({ content: [{ type: "image" }] }, {}, theme);
    expect(theme.bold).toHaveBeenCalledWith("edit");
    expect(theme.bold).toHaveBeenCalledWith("write");

    getTool(tools, "find").renderCall({}, theme);
    getTool(tools, "find").renderResult({ content: [{ type: "image" }] }, {}, theme);
    getTool(tools, "grep").renderCall({}, theme);
    getTool(tools, "grep").renderResult({ content: [{ type: "image" }] }, {}, theme);
    getTool(tools, "ls").renderCall({}, theme);
    getTool(tools, "ls").renderResult({ content: [{ type: "image" }] }, {}, theme);
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", " in .");
    expect(theme.fg).toHaveBeenCalledWith("accent", "//");
    expect(theme.fg).toHaveBeenCalledWith("accent", ".");
  });
});
