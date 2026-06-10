import { vi, type Mock } from "vitest";

export interface NamedRegistration {
  readonly name: string;
}

export interface MockExtensionApi<TApi, TTool extends NamedRegistration, TCommand, TEventHandler> {
  readonly api: TApi;
  readonly tools: Map<string, TTool>;
  readonly commands: Map<string, TCommand>;
  readonly events: Map<string, TEventHandler[]>;
  readonly appendEntry: ReturnType<typeof vi.fn>;
  readonly registerCommand: ReturnType<typeof vi.fn>;
}

export function createMockExtensionApi<
  TApi,
  TTool extends NamedRegistration,
  TCommand,
  TEventHandler = (...args: readonly unknown[]) => unknown,
>(): MockExtensionApi<TApi, TTool, TCommand, TEventHandler> {
  const tools = new Map<string, TTool>();
  const commands = new Map<string, TCommand>();
  const events = new Map<string, TEventHandler[]>();
  const appendEntry = vi.fn();
  const registerCommand = vi.fn((name: string, command: TCommand) => {
    commands.set(name, command);
  });

  const api = {
    registerTool: (tool: TTool) => {
      tools.set(tool.name, tool);
    },
    registerCommand,
    appendEntry,
    on: (event: string, handler: TEventHandler) => {
      const handlers = events.get(event) ?? [];
      handlers.push(handler);
      events.set(event, handlers);
    },
  } as TApi;

  return { api, tools, commands, events, appendEntry, registerCommand };
}

export function getRegisteredTool<TTool>(tools: ReadonlyMap<string, TTool>, name: string): TTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

export function getRegisteredCommand<TCommand>(
  commands: ReadonlyMap<string, TCommand>,
  name: string,
): TCommand {
  const command = commands.get(name);
  if (!command) throw new Error(`missing command ${name}`);
  return command;
}

export function getRegisteredEventHandlers<TEventHandler>(
  events: ReadonlyMap<string, readonly TEventHandler[]>,
  name: string,
): readonly TEventHandler[] {
  const handlers = events.get(name);
  if (!handlers) throw new Error(`missing event ${name}`);
  return handlers;
}

export function getRegisteredEventHandler<TEventHandler>(
  events: ReadonlyMap<string, readonly TEventHandler[]>,
  name: string,
): TEventHandler {
  const handler = getRegisteredEventHandlers(events, name)[0];
  if (!handler) throw new Error(`missing event handler ${name}`);
  return handler;
}

export interface MockTheme {
  readonly fg: Mock<(color: string, text: string) => string>;
  readonly bold: Mock<(text: string) => string>;
}

export function createMockTheme(options?: {
  readonly colorTemplate?: (color: string, text: string) => string;
  readonly boldTemplate?: (text: string) => string;
}): MockTheme {
  return {
    fg: vi.fn(options?.colorTemplate ?? ((_, text: string) => text)),
    bold: vi.fn(options?.boldTemplate ?? ((text: string) => text)),
  };
}
