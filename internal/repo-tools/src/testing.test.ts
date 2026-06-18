import { describe, expect, test } from "vitest";

import {
  createMockExtensionApi,
  createMockTheme,
  getRegisteredCommand,
  getRegisteredEventHandler,
  getRegisteredEventHandlers,
  getRegisteredTool,
} from "./testing";

interface Tool {
  readonly name: string;
  readonly execute: () => string;
}

type Command = () => string;
type EventHandler = (value: string) => string;

describe("repo test helpers", () => {
  test("records extension tools, commands, event handlers, and appended entries", () => {
    const mock = createMockExtensionApi<Tool, Command, EventHandler>();
    const tool = { name: "tool", execute: () => "tool-result" };
    const command = () => "command-result";
    const handler = (value: string) => `handled ${value}`;

    mock.api.registerTool(tool);
    mock.api.registerCommand("command", command);
    mock.api.on("event", handler);
    mock.api.appendEntry({ id: "entry" });

    expect(getRegisteredTool(mock.tools, "tool").execute()).toBe("tool-result");
    expect(getRegisteredCommand(mock.commands, "command")()).toBe("command-result");
    expect(getRegisteredEventHandlers(mock.events, "event")).toEqual([handler]);
    expect(getRegisteredEventHandler(mock.events, "event")("value")).toBe("handled value");
    expect(mock.appendEntry).toHaveBeenCalledWith({ id: "entry" });
    expect(mock.registerCommand).toHaveBeenCalledWith("command", command);
  });

  test("throws for missing registrations", () => {
    const mock = createMockExtensionApi<Tool, Command, EventHandler>();
    mock.events.set("empty", []);

    expect(() => getRegisteredTool(mock.tools, "missing")).toThrow("missing tool missing");
    expect(() => getRegisteredCommand(mock.commands, "missing")).toThrow("missing command missing");
    expect(() => getRegisteredEventHandlers(mock.events, "missing")).toThrow(
      "missing event missing",
    );
    expect(() => getRegisteredEventHandler(mock.events, "empty")).toThrow(
      "missing event handler empty",
    );
  });

  test("creates default and customized mock themes", () => {
    const defaultTheme = createMockTheme();
    expect(defaultTheme.fg("success", "text")).toBe("text");
    expect(defaultTheme.bold("text")).toBe("text");

    const customTheme = createMockTheme({
      colorTemplate: (color, text) => `${color}:${text}`,
      boldTemplate: (text) => `bold:${text}`,
    });
    expect(customTheme.fg("success", "text")).toBe("success:text");
    expect(customTheme.bold("text")).toBe("bold:text");
  });
});
