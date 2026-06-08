import { describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import ayu, { buildHelpText, sendPrompt } from "./index";

interface RegisteredCommand {
  readonly description?: string;
  readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

function createMockApi(): {
  readonly api: ExtensionAPI;
  readonly commands: Map<string, RegisteredCommand>;
  readonly sendUserMessage: ReturnType<typeof vi.fn>;
} {
  const commands = new Map<string, RegisteredCommand>();
  const sendUserMessage = vi.fn();

  const api = {
    registerCommand: (name: string, options: RegisteredCommand) => {
      commands.set(name, options);
    },
    on: vi.fn(),
    sendUserMessage,
  } as unknown as ExtensionAPI;

  return { api, commands, sendUserMessage };
}

function createContext(options?: { readonly idle?: boolean }) {
  return {
    isIdle: () => options?.idle ?? true,
    ui: {
      notify: vi.fn(),
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

describe("Ayu workflow extension", () => {
  test("registers /ayu command only", () => {
    const { api, commands } = createMockApi();
    ayu(api);

    expect(commands.has("ayu")).toBe(true);
    expect(commands.size).toBe(1);
  });

  test("builds workflow help text", () => {
    const help = buildHelpText();
    expect(help).toContain("Ayu workflow");
    expect(help).toContain("/ayu task");
    expect(help).toContain("/ayu review");
    expect(help).toContain("/ayu docs");
    expect(help).toContain("/ayu release");
    expect(help).toContain("/ayu verify");
    expect(help).toContain("/ayu audit");
  });

  test("shows help on empty or help args", async () => {
    const { api, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();

    await command.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Ayu workflow"), "info");

    await command.handler("   ", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Ayu workflow"), "info");

    await command.handler("help", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("/ayu task"), "info");
  });

  test("routes workflow prompts immediately or as follow-up", async () => {
    const { api, commands, sendUserMessage } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");

    const idleCtx = createContext({ idle: true });
    await command.handler("task add tests", idleCtx);
    expect(sendUserMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Task input:\nadd tests"),
    );

    await command.handler("  goal   finish coverage  ", idleCtx);
    expect(sendUserMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Goal: finish coverage"),
    );

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

  test("falls back when split returns no first command", async () => {
    const { api, commands } = createMockApi();
    ayu(api);
    const command = getCommand(commands, "ayu");
    const ctx = createContext();
    const args = {
      trim: () => ({
        split: () => [],
      }),
    };

    await command.handler(args as never, ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Ayu workflow"),
      "warning",
    );
  });
});

describe("sendPrompt", () => {
  test("sends immediately when idle", () => {
    const sendUserMessage = vi.fn();
    const pi = { sendUserMessage } as unknown as ExtensionAPI;
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() },
    } as unknown as ExtensionCommandContext;

    sendPrompt("test prompt", pi, ctx);
    expect(sendUserMessage).toHaveBeenCalledWith("test prompt");
  });

  test("queues as follow-up when busy", () => {
    const sendUserMessage = vi.fn();
    const pi = { sendUserMessage } as unknown as ExtensionAPI;
    const ctx = {
      isIdle: () => false,
      ui: { notify: vi.fn() },
    } as unknown as ExtensionCommandContext;

    sendPrompt("test prompt", pi, ctx);
    expect(sendUserMessage).toHaveBeenCalledWith("test prompt", { deliverAs: "followUp" });
    expect(ctx.ui.notify).toHaveBeenCalledWith("Ayu command queued as follow-up.", "info");
  });
});
