import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function shortenPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

interface CompactState {
  enabled: boolean;
}

const COMPACT_ENTRY_TYPE = "pi-compact.state";

function getBuiltInTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
  };
}

function fullText(result: { content: Array<{ type: string; text?: string }> }): string | undefined {
  const c = result.content.find((x): x is { type: "text"; text: string } => x.type === "text");
  return c?.text;
}

export default function compactExtension(pi: ExtensionAPI) {
  let compactMode = true;

  function persistState(): void {
    pi.appendEntry<CompactState>(COMPACT_ENTRY_TYPE, { enabled: compactMode });
  }

  function restoreState(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries();
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === COMPACT_ENTRY_TYPE) {
        const data = entry.data as CompactState | undefined;
        if (data && typeof data.enabled === "boolean") {
          compactMode = data.enabled;
        }
      }
    }
  }

  function isCompact(): boolean {
    return compactMode;
  }

  function fullRender(
    result: { content: Array<{ type: string; text?: string }> },
    theme: Pick<Theme, "fg">,
  ): Text {
    const text = fullText(result);
    if (!text) return new Text("", 0, 0);
    const lines = text
      .trim()
      .split("\n")
      .map((line) => theme.fg("toolOutput", line))
      .join("\n");
    return new Text(`\n${lines}`, 0, 0);
  }

  // ─── Read Tool ───
  pi.registerTool({
    name: "read",
    label: "read",
    description: getBuiltInTools(process.cwd()).read.description,
    parameters: getBuiltInTools(process.cwd()).read.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.read.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const path = shortenPath(args.path || "");
      const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
      let text = `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`;
      if (args.offset !== undefined || args.limit !== undefined) {
        const startLine = args.offset ?? 1;
        const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
        text += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
      }
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (!text) return new Text("", 0, 0);
      const count = text.trim().split("\n").filter(Boolean).length;
      if (count === 0) return new Text(theme.fg("dim", "→ empty"), 0, 0);
      return new Text(theme.fg("muted", `→ ${count} lines`), 0, 0);
    },
  });

  // ─── Bash Tool ───
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: getBuiltInTools(process.cwd()).bash.description,
    parameters: getBuiltInTools(process.cwd()).bash.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.bash.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const command = args.command || "...";
      const timeout = args.timeout as number | undefined;
      const timeoutSuffix = timeout ? theme.fg("muted", ` (${timeout}s)`) : "";
      return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix, 0, 0);
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (!text) return new Text("", 0, 0);
      const trimmed = text.trim();
      if (!trimmed) return new Text(theme.fg("dim", "→ done"), 0, 0);
      const lines = trimmed.split("\n");
      if (lines.length === 1 && lines[0]!.length < 40) {
        return new Text(theme.fg("muted", `→ ${lines[0]}`), 0, 0);
      }
      return new Text(theme.fg("muted", `→ ${lines.length} lines`), 0, 0);
    },
  });

  // ─── Edit Tool ───
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: getBuiltInTools(process.cwd()).edit.description,
    parameters: getBuiltInTools(process.cwd()).edit.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.edit.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const path = shortenPath(args.path || "");
      const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
      return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`, 0, 0);
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (!text) return new Text("", 0, 0);
      if (text.includes("Error") || text.includes("error")) {
        return new Text(theme.fg("error", "→ failed"), 0, 0);
      }
      const added = (text.match(/^\+ /gm) ?? []).length;
      const removed = (text.match(/^- /gm) ?? []).length;
      if (added === 0 && removed === 0) {
        return new Text(theme.fg("success", "→ edited"), 0, 0);
      }
      return new Text(
        theme.fg("success", "→ edited ") +
          theme.fg("toolDiffAdded", `+${added} `) +
          theme.fg("toolDiffRemoved", `-${removed}`),
        0,
        0,
      );
    },
  });

  // ─── Write Tool ───
  pi.registerTool({
    name: "write",
    label: "write",
    description: getBuiltInTools(process.cwd()).write.description,
    parameters: getBuiltInTools(process.cwd()).write.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.write.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const path = shortenPath(args.path || "");
      const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
      const lineCount = args.content ? (args.content as string).split("\n").length : 0;
      const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`,
        0,
        0,
      );
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (text) {
        return new Text(theme.fg("error", `→ ${text}`), 0, 0);
      }
      return new Text(theme.fg("success", "→ written"), 0, 0);
    },
  });

  // ─── Find Tool ───
  pi.registerTool({
    name: "find",
    label: "find",
    description: getBuiltInTools(process.cwd()).find.description,
    parameters: getBuiltInTools(process.cwd()).find.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.find.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const pattern = args.pattern || "";
      const path = shortenPath(args.path || ".");
      let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
      text += theme.fg("toolOutput", ` in ${path}`);
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (!text) return new Text("", 0, 0);
      const count = text.trim().split("\n").filter(Boolean).length;
      if (count === 0) return new Text(theme.fg("dim", "→ none"), 0, 0);
      return new Text(theme.fg("muted", `→ ${count} files`), 0, 0);
    },
  });

  // ─── Grep Tool ───
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: getBuiltInTools(process.cwd()).grep.description,
    parameters: getBuiltInTools(process.cwd()).grep.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.grep.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const pattern = args.pattern || "";
      const path = shortenPath(args.path || ".");
      let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
      text += theme.fg("toolOutput", ` in ${path}`);
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (!text) return new Text("", 0, 0);
      const count = text.trim().split("\n").filter(Boolean).length;
      if (count === 0) return new Text(theme.fg("dim", "→ none"), 0, 0);
      return new Text(theme.fg("muted", `→ ${count} matches`), 0, 0);
    },
  });

  // ─── Ls Tool ───
  pi.registerTool({
    name: "ls",
    label: "ls",
    description: getBuiltInTools(process.cwd()).ls.description,
    parameters: getBuiltInTools(process.cwd()).ls.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tools = getBuiltInTools(ctx.cwd);
      return tools.ls.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      const path = shortenPath(args.path || ".");
      return new Text(
        `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`,
        0,
        0,
      );
    },
    renderResult(result, options, theme) {
      if (!isCompact() || options.expanded) {
        return fullRender(result, theme);
      }
      const text = fullText(result);
      if (!text) return new Text("", 0, 0);
      const count = text.trim().split("\n").filter(Boolean).length;
      if (count === 0) return new Text(theme.fg("dim", "→ empty"), 0, 0);
      return new Text(theme.fg("muted", `→ ${count} entries`), 0, 0);
    },
  });

  // ─── /compact Command ───
  pi.registerCommand("compact", {
    description: "Toggle compact output mode",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "on") {
        compactMode = true;
        persistState();
        ctx.ui.notify("Compact mode: on", "info");
        return;
      }

      if (trimmed === "off") {
        compactMode = false;
        persistState();
        ctx.ui.notify("Compact mode: off", "info");
        return;
      }

      if (trimmed === "status" || !trimmed) {
        ctx.ui.notify(`Compact mode: ${compactMode ? "on" : "off"}`, "info");
        return;
      }

      ctx.ui.notify("Usage: /compact on | /compact off | /compact status", "warning");
    },
  });

  // ─── Session Lifecycle ───
  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreState(ctx);
  });
}
