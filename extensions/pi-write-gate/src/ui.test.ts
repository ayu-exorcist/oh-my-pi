import { describe, expect, test, vi } from "vitest";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager as TuiKeybindingsManager,
  TUI,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";
import {
  applyWriteModeLabel,
  buildHelpText,
  buildStyledWriteModeLabel,
  buildWriteModeLabel,
  requestEditorRender,
  setPermissionMode,
  setWriteEnabled,
  setWriteStatus,
  togglePermissionMode,
  toggleWriteMode,
  WriteModeEditor,
} from "./ui";
import type { WriteGateState, StatusStyler } from "./ui";

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
    borderColor: (text) => text,
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  };
}

describe("Write Gate UI helpers", () => {
  test("builds write mode labels and help text", () => {
    expect(buildWriteModeLabel("on")).toBe("Write Mode: On");
    expect(buildWriteModeLabel("off")).toBe("Write Mode: Off");

    const help = buildHelpText("off");
    expect(help).toContain("Write Gate");
    expect(help).toContain("Write Mode: Off");
    expect(help).toContain("/write-gate [write] on");
    expect(help).not.toContain("/ayu on|off|status");
    expect(help).toContain("Alt+S");
  });

  test("styles the editor label when a styler is present", () => {
    const styler = { fg: vi.fn((color: "accent", text: string) => `<${color}>${text}</${color}>`) };

    expect(buildStyledWriteModeLabel("on", styler)).toBe("<accent> Write Mode: On </accent>");
    expect(styler.fg).toHaveBeenCalledWith("accent", " Write Mode: On ");
    expect(buildStyledWriteModeLabel("off")).toBe(" Write Mode: Off ");
    expect(buildStyledWriteModeLabel("on", {} as StatusStyler)).toBe(" Write Mode: On ");
  });

  test("requests editor render and clears footer status", () => {
    const requestRender = vi.fn();
    const setStatus = vi.fn();
    const state: WriteGateState = { mode: "off", activeTui: { requestRender } };

    requestEditorRender(state);
    expect(requestRender).toHaveBeenCalledTimes(1);

    setWriteStatus(state, { ui: { setStatus } });
    expect(setStatus).toHaveBeenCalledWith("write-gate-mode", undefined);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  test("sets and toggles write mode", () => {
    const requestRender = vi.fn();
    const state: WriteGateState = { mode: "off", activeTui: { requestRender } };

    setPermissionMode(state, "on", {});
    expect(state.mode).toBe("on");
    expect(requestRender).toHaveBeenCalledTimes(1);

    togglePermissionMode(state, {});
    expect(state.mode).toBe("auto");
    expect(requestRender).toHaveBeenCalledTimes(2);

    togglePermissionMode(state, {});
    expect(state.mode).toBe("off");
    expect(requestRender).toHaveBeenCalledTimes(3);
  });

  test("applies write mode label to editor render lines", () => {
    expect(applyWriteModeLabel([], 20, "on")).toEqual([]);

    const lines = applyWriteModeLabel(["01234567890123456789", "second"], 20, "on");
    expect(lines[0]).toContain(" Write Mode: On 0123");
    expect(lines[1]).toBe("second");

    const styled = applyWriteModeLabel(["0123456789"], 24, "off", {
      fg: (_color, text) => `[${text}]`,
    });
    expect(styled[0]).toContain("[ Write Mode: Off ]012345");
  });

  test("WriteModeEditor renders a live write mode label", () => {
    const state: WriteGateState = { mode: "on", activeTui: undefined };
    const tui = createTui();
    const editor = new WriteModeEditor(
      tui,
      createEditorTheme(),
      new TuiKeybindingsManager(TUI_KEYBINDINGS) as KeybindingsManager,
      state,
      { fg: (_color, text) => text },
    );

    const enabledLines = editor.render(40);
    expect(state.activeTui).toBe(tui);
    expect(enabledLines[0]).toContain(" Write Mode: On ");

    state.mode = "off";
    const disabledLines = editor.render(40);
    expect(disabledLines[0]).toContain(" Write Mode: Off ");
  });

  test("setWriteEnabled sets mode via boolean", () => {
    const requestRender = vi.fn();
    const state: WriteGateState = { mode: "off", activeTui: { requestRender } };

    setWriteEnabled(state, true, {});
    expect(state.mode).toBe("on");
    expect(requestRender).toHaveBeenCalledTimes(1);

    setWriteEnabled(state, false, {});
    expect(state.mode).toBe("off");
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  test("toggleWriteMode toggles between off and on", () => {
    const requestRender = vi.fn();
    const state: WriteGateState = { mode: "off", activeTui: { requestRender } };

    toggleWriteMode(state, {});
    expect(state.mode).toBe("on");
    expect(requestRender).toHaveBeenCalledTimes(1);
  });
});
