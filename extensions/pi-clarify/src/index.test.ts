import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import clarify, {
  appendClarifyEntry,
  buildPromptGuidelines,
  resultText,
  toolResult,
  renderClarifyCall,
  renderClarifyResult,
} from "./index";
import type { AskUserDetails } from "./schema";

vi.mock("@earendil-works/pi-tui", () => ({
  Text: class {
    constructor(public text: string) {}
  },
}));

interface MockTheme {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
}

interface RegisteredTool {
  readonly name: string;
  readonly execute: (
    toolCallId: string,
    params: never,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: AskUserDetails }>;
  readonly renderCall?: (args: unknown, theme: MockTheme) => unknown;
  readonly renderResult?: (result: unknown, options: unknown, theme: MockTheme) => unknown;
}

interface RegisteredCommand {
  readonly description?: string;
  readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

function createMockApi(): {
  readonly api: ExtensionAPI;
  readonly tools: Map<string, RegisteredTool>;
  readonly commands: Map<string, RegisteredCommand>;
  readonly appendEntry: ReturnType<typeof vi.fn>;
} {
  const tools = new Map<string, RegisteredTool>();
  const commands = new Map<string, RegisteredCommand>();
  const appendEntry = vi.fn();

  const api = {
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
    registerCommand: (name: string, command: RegisteredCommand) => {
      commands.set(name, command);
    },
    appendEntry,
  } as unknown as ExtensionAPI;

  return { api, tools, commands, appendEntry };
}

const askWithClarifyUi = vi.hoisted(() => vi.fn());

vi.mock("./ui", () => ({
  askWithClarifyUi,
}));

function createContext(options?: { readonly hasUI?: boolean }) {
  return {
    hasUI: options?.hasUI ?? true,
    ui: {
      notify: vi.fn(),
    },
  } as unknown as ExtensionCommandContext;
}

function createMockTheme(): MockTheme {
  return {
    fg: vi.fn((_, text) => text),
    bold: vi.fn((text) => text),
  };
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

describe("pi-clarify extension", () => {
  beforeEach(() => {
    askWithClarifyUi.mockReset();
  });

  test("registers ask_user tool and clarify command", () => {
    const { api, tools, commands } = createMockApi();
    clarify(api);

    expect(tools.has("ask_user")).toBe(true);
    expect(commands.has("clarify")).toBe(true);
  });

  test("returns selected answer", async () => {
    const { api, tools, appendEntry } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");
    const ctx = createContext();
    askWithClarifyUi.mockResolvedValue({ type: "select", value: "docs", label: "Docs" });

    const result = await tool.execute(
      "tool-1",
      {
        type: "select",
        message: "Which change first?",
        options: [
          { value: "docs", label: "Docs", hint: "Lowest risk" },
          { value: "runtime", label: "Runtime", hint: "Higher impact" },
        ],
      } as never,
      undefined,
      undefined,
      ctx,
    );

    expect(result.details).toMatchObject({
      status: "answered",
      answer: { type: "select", value: "docs", label: "Docs" },
    });
    expect(result.content[0]?.text).toBe("User selected: Docs");
    expect(appendEntry).toHaveBeenCalledWith(
      "pi-clarify.answer",
      expect.objectContaining({ status: "answered", promptType: "select" }),
    );
  });

  test("returns custom select answer", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");
    const ctx = createContext();
    askWithClarifyUi.mockResolvedValue({ type: "custom", value: "Start with docs" });

    const result = await tool.execute(
      "tool-1",
      {
        type: "select",
        message: "Which change first?",
        options: [
          { value: "docs", label: "Docs" },
          { value: "runtime", label: "Runtime" },
        ],
        allowCustom: true,
      } as never,
      undefined,
      undefined,
      ctx,
    );

    expect(result.details.answer).toEqual({ type: "custom", value: "Start with docs" });
  });

  test("returns text and confirm answers", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");

    const textResult = await tool.execute(
      "tool-1",
      { type: "text", message: "Name?" } as never,
      undefined,
      undefined,
      (askWithClarifyUi.mockResolvedValueOnce({ type: "text", value: "Clarify" }), createContext()),
    );
    expect(textResult.details.answer).toEqual({ type: "text", value: "Clarify" });

    const confirmResult = await tool.execute(
      "tool-2",
      { type: "confirm", message: "Proceed?" } as never,
      undefined,
      undefined,
      (askWithClarifyUi.mockResolvedValueOnce({ type: "confirm", value: true }), createContext()),
    );
    expect(confirmResult.details.answer).toEqual({ type: "confirm", value: true });
  });

  test("returns multiselect answer", async () => {
    const { api, tools, appendEntry } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");
    const ctx = createContext();
    askWithClarifyUi.mockResolvedValue({
      type: "multiselect",
      values: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    });

    const result = await tool.execute(
      "tool-1",
      {
        type: "multiselect",
        message: "Pick items",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ],
      } as never,
      undefined,
      undefined,
      ctx,
    );

    expect(result.details).toMatchObject({
      status: "answered",
      answer: {
        type: "multiselect",
        values: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    });
    expect(result.content[0]?.text).toBe("User selected: A, B");
    expect(appendEntry).toHaveBeenCalledWith(
      "pi-clarify.answer",
      expect.objectContaining({ status: "answered", promptType: "multiselect" }),
    );
  });

  test("returns cancellation for empty input", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");

    const result = await tool.execute(
      "tool-1",
      { type: "text", message: "Name?" } as never,
      undefined,
      undefined,
      (askWithClarifyUi.mockResolvedValue(undefined), createContext()),
    );

    expect(result.details.status).toBe("cancelled");
  });

  test("returns unavailable without reason fallback", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");

    const result = await tool.execute(
      "tool-1",
      { type: "text", message: "What should I do?" } as never,
      undefined,
      undefined,
      createContext({ hasUI: false }),
    );

    expect(result.details.status).toBe("unavailable");
    expect(result.content[0]?.text).toBe(
      "Clarification UI is unavailable in this mode. Ask the question in plain text instead.",
    );
  });

  test("returns rejected without reason fallback", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");

    const result = await tool.execute(
      "tool-1",
      { type: "text", message: "" } as never,
      undefined,
      undefined,
      createContext(),
    );

    expect(result.details.status).toBe("rejected");
    expect(result.content[0]?.text).toBe("Clarification message must not be empty.");
  });

  test("rejects unsafe prompts and handles missing UI", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");

    const rejected = await tool.execute(
      "tool-1",
      { type: "text", message: "Enter your password" } as never,
      undefined,
      undefined,
      createContext(),
    );
    expect(rejected.details.status).toBe("rejected");

    const unavailable = await tool.execute(
      "tool-2",
      { type: "text", message: "What should I do?" } as never,
      undefined,
      undefined,
      createContext({ hasUI: false }),
    );
    expect(unavailable.details.status).toBe("unavailable");
  });

  test("supports clarify status, demo, and help fallback", async () => {
    const { api, commands } = createMockApi();
    clarify(api);
    const command = getCommand(commands, "clarify");
    const ctx = createContext();
    askWithClarifyUi.mockResolvedValue({ type: "select", value: "continue", label: "Continue" });

    await command.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Pi Clarify: enabled\nSupported prompt types: select, multiselect, text, confirm",
      "info",
    );

    await command.handler("demo", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("User selected: Continue", "info");

    await command.handler("wat", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "Usage: /clarify status | /clarify demo",
      "warning",
    );
  });

  test("handles demo cancellation", async () => {
    const { api, commands } = createMockApi();
    clarify(api);
    const command = getCommand(commands, "clarify");
    const ctx = createContext();
    askWithClarifyUi.mockResolvedValue(undefined);

    await command.handler("demo", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Pi Clarify demo cancelled.", "warning");
  });

  test("handles demo without UI", async () => {
    const { api, commands } = createMockApi();
    clarify(api);
    const command = getCommand(commands, "clarify");
    const ctx = createContext({ hasUI: false });

    await command.handler("demo", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Pi Clarify demo cancelled.", "warning");
  });
});

describe("renderCall", () => {
  test("renders ask_user with message", () => {
    const theme = createMockTheme();
    const result = renderClarifyCall({ message: "What should I do?" }, theme);
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("toolTitle", expect.any(String));
    expect(theme.bold).toHaveBeenCalledWith("ask_user ");
  });

  test("handles non-string message", () => {
    const theme = createMockTheme();
    const result = renderClarifyCall({ message: 123 }, theme);
    expect(result).toBeDefined();
  });
});

describe("renderResult", () => {
  test("renders answered status", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "User selected: Docs" }],
        details: { status: "answered" },
      },
      theme,
    );
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("success", expect.any(String));
  });

  test("renders cancelled status", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Cancelled" }],
        details: { status: "cancelled" },
      },
      theme,
    );
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("warning", "Cancelled");
  });

  test("renders rejected status as error", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Rejected" }],
        details: { status: "rejected" },
      },
      theme,
    );
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("error", "Rejected");
  });

  test("renders unavailable status as error", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Unavailable" }],
        details: { status: "unavailable" },
      },
      theme,
    );
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("error", "Unavailable");
  });

  test("handles missing details", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Fallback" }],
      },
      theme,
    );
    expect(result).toBeDefined();
  });

  test("handles missing content", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [],
        details: { status: "answered" },
      },
      theme,
    );
    expect(result).toBeDefined();
  });

  test("handles non-text content type", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "image" }],
      },
      theme,
    );
    expect(result).toBeDefined();
  });

  test("handles non-object details", () => {
    const theme = createMockTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Fallback" }],
        details: "string-details",
      },
      theme,
    );
    expect(result).toBeDefined();
  });
});

describe("resultText", () => {
  test("returns formatted answer for answered status", () => {
    expect(
      resultText({
        status: "answered",
        promptType: "select",
        message: "Test?",
        answer: { type: "select", value: "a", label: "A" },
      }),
    ).toBe("User selected: A");

    expect(
      resultText({
        status: "answered",
        promptType: "multiselect",
        message: "Test?",
        answer: {
          type: "multiselect",
          values: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      }),
    ).toBe("User selected: A, B");
  });

  test("returns cancelled message", () => {
    expect(
      resultText({
        status: "cancelled",
        promptType: "text",
        message: "Test?",
      }),
    ).toBe("User cancelled the clarification prompt.");
  });

  test("returns unavailable reason", () => {
    expect(
      resultText({
        status: "unavailable",
        promptType: "text",
        message: "Test?",
        reason: "UI not ready",
      }),
    ).toBe("UI not ready");
  });

  test("returns unavailable fallback", () => {
    expect(
      resultText({
        status: "unavailable",
        promptType: "text",
        message: "Test?",
      }),
    ).toBe("Clarification UI is unavailable.");
  });

  test("returns rejected reason", () => {
    expect(
      resultText({
        status: "rejected",
        promptType: "text",
        message: "Test?",
        reason: "Invalid params",
      }),
    ).toBe("Invalid params");
  });

  test("returns rejected fallback", () => {
    expect(
      resultText({
        status: "rejected",
        promptType: "text",
        message: "Test?",
      }),
    ).toBe("Clarification prompt was rejected.");
  });
});

describe("toolResult", () => {
  test("wraps details into tool result", () => {
    const details: AskUserDetails = {
      status: "answered",
      promptType: "select",
      message: "Which?",
      answer: { type: "select", value: "docs", label: "Docs" },
    };
    const result = toolResult(details);
    expect(result.content[0]?.text).toBe("User selected: Docs");
    expect(result.details).toBe(details);
  });
});

describe("appendClarifyEntry", () => {
  test("appends entry with timestamp", () => {
    const appendEntry = vi.fn();
    const pi = { appendEntry } as unknown as ExtensionAPI;
    const details: AskUserDetails = {
      status: "answered",
      promptType: "select",
      message: "Which?",
      answer: { type: "select", value: "docs", label: "Docs" },
    };
    appendClarifyEntry(pi, details);
    expect(appendEntry).toHaveBeenCalledWith(
      "pi-clarify.answer",
      expect.objectContaining({
        status: "answered",
        promptType: "select",
        message: "Which?",
        timestamp: expect.any(String),
      }),
    );
  });
});

describe("buildPromptGuidelines", () => {
  test("returns guideline strings", () => {
    const guidelines = buildPromptGuidelines();
    expect(guidelines.length).toBeGreaterThan(0);
    expect(guidelines[0]).toContain("ask_user");
  });
});
