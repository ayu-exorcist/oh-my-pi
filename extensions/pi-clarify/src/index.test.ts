import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMockExtensionApi,
  createMockTheme,
  getRegisteredCommand as getCommand,
  getRegisteredEventHandler,
  getRegisteredTool as getTool,
} from "@ayulab/repo-tools/testing";
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

type InputHandler = (
  event: { readonly text: string },
  ctx: ExtensionCommandContext,
) => Promise<{ readonly action: string }> | { readonly action: string };

function createMockApi() {
  return createMockExtensionApi<ExtensionAPI, RegisteredTool, RegisteredCommand, InputHandler>();
}

const askWithClarifyUi = vi.hoisted(() => vi.fn());
const cancelClarifyInput = vi.hoisted(() => vi.fn());
const handleClarifyInput = vi.hoisted(() => vi.fn(() => ({ handled: false, valid: false })));
const isClarifyPending = vi.hoisted(() => vi.fn(() => false));

vi.mock("./ui", () => ({
  askWithClarifyUi,
  cancelClarifyInput,
  handleClarifyInput,
  isClarifyPending,
}));

function createContext(options?: { readonly hasUI?: boolean }) {
  return {
    hasUI: options?.hasUI ?? true,
    ui: {
      notify: vi.fn(),
    },
  } as unknown as ExtensionCommandContext;
}

function createTheme(): MockTheme {
  return createMockTheme() as MockTheme;
}

describe("pi-clarify extension", () => {
  beforeEach(() => {
    askWithClarifyUi.mockReset();
    cancelClarifyInput.mockReset();
    handleClarifyInput.mockReset();
    handleClarifyInput.mockReturnValue({ handled: false, valid: false });
    isClarifyPending.mockReset();
    isClarifyPending.mockReturnValue(false);
  });

  test("registers ask_user tool, input handler, and clarify command", () => {
    const { api, tools, commands, events } = createMockApi();
    clarify(api);

    expect(tools.has("ask_user")).toBe(true);
    expect(commands.has("clarify")).toBe(true);
    expect(events.has("input")).toBe(true);
  });

  test("input handler continues when no clarification is pending", async () => {
    const { api, events } = createMockApi();
    clarify(api);
    const handler = getRegisteredEventHandler(events, "input");

    isClarifyPending.mockReturnValue(false);
    await expect(handler({ text: "1" }, createContext())).resolves.toEqual({ action: "continue" });
  });

  test("input handler handles valid and invalid clarification replies", async () => {
    const { api, events } = createMockApi();
    clarify(api);
    const handler = getRegisteredEventHandler(events, "input");
    const ctx = createContext();

    isClarifyPending.mockReturnValue(true);
    handleClarifyInput.mockReturnValueOnce({ handled: true, valid: false });
    await expect(handler({ text: "bad" }, ctx)).resolves.toEqual({ action: "handled" });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Invalid input. Please try again or send empty message to cancel.",
      "warning",
    );

    handleClarifyInput.mockReturnValueOnce({ handled: true, valid: true });
    await expect(handler({ text: "1" }, ctx)).resolves.toEqual({ action: "handled" });

    handleClarifyInput.mockReturnValueOnce({ handled: false, valid: false });
    await expect(handler({ text: "noop" }, ctx)).resolves.toEqual({ action: "continue" });
  });

  test("registered tool render callbacks delegate to render helpers", () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");
    const theme = createTheme();

    expect(tool.renderCall?.({ type: "text", message: "Question?" }, theme)).toBeDefined();
    expect(
      tool.renderResult?.(
        {
          content: [{ type: "text", text: "Answered" }],
          details: { status: "answered" },
        },
        undefined,
        theme,
      ),
    ).toBeDefined();
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

  test("returns cancellation on UI rejection and abort", async () => {
    const { api, tools } = createMockApi();
    clarify(api);
    const tool = getTool(tools, "ask_user");

    const rejected = await tool.execute(
      "tool-1",
      { type: "text", message: "Name?" } as never,
      undefined,
      undefined,
      (askWithClarifyUi.mockRejectedValueOnce(new Error("closed")), createContext()),
    );
    expect(rejected.details.status).toBe("cancelled");

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const aborted = await tool.execute(
      "tool-2",
      { type: "text", message: "Name?" } as never,
      alreadyAborted.signal,
      undefined,
      (askWithClarifyUi.mockResolvedValueOnce({ type: "text", value: "late" }), createContext()),
    );
    expect(aborted.details.status).toBe("cancelled");
    expect(cancelClarifyInput).toHaveBeenCalled();

    const controller = new AbortController();
    let resolveUi: (value: unknown) => void = () => undefined;
    askWithClarifyUi.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUi = resolve;
      }),
    );
    const pending = tool.execute(
      "tool-3",
      { type: "text", message: "Name?" } as never,
      controller.signal,
      undefined,
      createContext(),
    );
    controller.abort();
    resolveUi({ type: "text", value: "late" });
    const abortedLater = await pending;
    expect(abortedLater.details.status).toBe("cancelled");
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
    const theme = createTheme();
    const result = renderClarifyCall({ type: "text", message: "What should I do?" }, theme);
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("accent", expect.any(String));
    expect(theme.fg).toHaveBeenCalledWith("text", expect.any(String));
  });

  test("renders select, multiselect, and confirm prompts", () => {
    const selectTheme = createTheme();
    renderClarifyCall(
      {
        type: "select",
        message: "Choose",
        options: [
          { value: "a", label: "A", hint: "First" },
          { value: "b", label: "B" },
        ],
        allowCustom: true,
        customLabel: "Other",
      },
      selectTheme,
    );
    expect(selectTheme.fg).toHaveBeenCalledWith("text", "Custom: Other");
    expect(selectTheme.fg).toHaveBeenCalledWith("muted", "First");

    const sparseSelectTheme = createTheme();
    renderClarifyCall(
      {
        type: "select",
        message: "Choose",
        options: [{ value: "a", label: "A" }, undefined] as never,
        allowCustom: true,
        customLabel: "   ",
      },
      sparseSelectTheme,
    );
    expect(sparseSelectTheme.fg).toHaveBeenCalledWith("text", "Custom: Custom...");

    const multiselectTheme = createTheme();
    renderClarifyCall(
      {
        type: "multiselect",
        message: "Choose many",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
      multiselectTheme,
    );
    expect(multiselectTheme.fg).toHaveBeenCalledWith(
      "muted",
      "Reply with numbers (e.g. 1 2 3) or 'all'. Empty message to cancel.",
    );

    const confirmTheme = createTheme();
    renderClarifyCall({ type: "confirm", message: "Proceed?" }, confirmTheme);
    expect(confirmTheme.fg).toHaveBeenCalledWith("text", "y/yes or n/no");
  });

  test("handles non-string message", () => {
    const theme = createTheme();
    const result = renderClarifyCall({ message: 123 }, theme);
    expect(result).toBeDefined();
  });

  test("renders select fallback branches", () => {
    const noOptionsTheme = createTheme();
    renderClarifyCall({ type: "select", message: "Choose", allowCustom: false }, noOptionsTheme);
    expect(noOptionsTheme.fg).toHaveBeenCalledWith(
      "muted",
      "Reply with option number. Empty message to cancel.",
    );
  });

  test("renders an empty text node for non-object args", () => {
    const theme = createTheme();
    const result = renderClarifyCall("not-args", theme);
    expect(result).toBeDefined();
  });

  test("renders an empty text node for unsupported prompt types", () => {
    const theme = createTheme();
    const result = renderClarifyCall({ type: "unsupported", message: "Choose" }, theme);
    expect(result).toBeDefined();
  });
});

describe("renderResult", () => {
  test("renders answered status", () => {
    const theme = createTheme();
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
    const theme = createTheme();
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
    const theme = createTheme();
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
    const theme = createTheme();
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
    const theme = createTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Fallback" }],
      },
      theme,
    );
    expect(result).toBeDefined();
  });

  test("handles missing content", () => {
    const theme = createTheme();
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
    const theme = createTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "image" }],
      },
      theme,
    );
    expect(result).toBeDefined();
  });

  test("handles non-object details", () => {
    const theme = createTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Fallback" }],
        details: "string-details",
      },
      theme,
    );
    expect(result).toBeDefined();
  });

  test("handles object details without string status", () => {
    const theme = createTheme();
    const result = renderClarifyResult(
      {
        content: [{ type: "text", text: "Fallback" }],
        details: { status: 123 },
      },
      theme,
    );
    expect(result).toBeDefined();
    expect(theme.fg).toHaveBeenCalledWith("error", "Fallback");
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
