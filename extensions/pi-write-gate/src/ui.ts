import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { PermissionMode } from "./mode";

export type StatusStyler = {
  fg?: (color: "accent", text: string) => string;
};

export type RenderTarget = Pick<TUI, "requestRender">;

export interface WriteGateState {
  mode: PermissionMode;
  activeTui: RenderTarget | undefined;
}

export type WriteStatusContext = {
  ui?: {
    setStatus?: (key: string, value?: string) => void;
  };
};

export function buildWriteModeLabel(mode: PermissionMode): string {
  const labelMap: Record<PermissionMode, string> = {
    off: "Off",
    on: "On",
    auto: "Auto",
  };
  return `Write Mode: ${labelMap[mode]}`;
}

export function buildHelpText(mode: PermissionMode): string {
  return `Write Gate

${buildWriteModeLabel(mode)}

Write Mode:
  Off  = discuss, plan, review, and inspect read-only; mutating tools are blocked
  On   = user-authorized local implementation; remains On until the user turns it Off
  Auto = routine edits auto-approved; risky actions still blocked or ask for confirmation

Commands:
  /write-gate [write] on       Enable Write Mode
  /write-gate [write] off      Disable Write Mode
  /write-gate auto             Enable Auto Mode
  /write-gate status           Show current session Write Mode
  /write-gate help             Show this help

Shortcut:
  Alt+S                      Cycle Write Mode (Off → On → Auto → Off)`;
}

export function buildStyledWriteModeLabel(mode: PermissionMode, styler?: StatusStyler): string {
  const label = ` ${buildWriteModeLabel(mode)} `;
  return typeof styler?.fg === "function" ? styler.fg("accent", label) : label;
}

export function requestEditorRender(state: WriteGateState): void {
  state.activeTui?.requestRender();
}

export function setWriteStatus(state: WriteGateState, ctx: WriteStatusContext): void {
  ctx.ui?.setStatus?.("write-gate-mode", undefined);
  requestEditorRender(state);
}

export function setPermissionMode(
  state: WriteGateState,
  mode: PermissionMode,
  ctx: WriteStatusContext,
): void {
  state.mode = mode;
  setWriteStatus(state, ctx);
}

export function togglePermissionMode(state: WriteGateState, ctx: WriteStatusContext): void {
  const cycle: Record<PermissionMode, PermissionMode> = { off: "on", on: "auto", auto: "off" };
  setPermissionMode(state, cycle[state.mode], ctx);
}

export function applyWriteModeLabel(
  lines: string[],
  width: number,
  mode: PermissionMode,
  styler?: StatusStyler,
): string[] {
  if (lines.length === 0) return lines;

  const label = buildStyledWriteModeLabel(mode, styler);
  lines[0] =
    label +
    truncateToWidth(lines[0] ?? "", Math.max(0, width - buildWriteModeLabel(mode).length - 2), "");
  return lines;
}

// Backward-compatible aliases
export function setWriteEnabled(
  state: WriteGateState,
  enabled: boolean,
  ctx: WriteStatusContext,
): void {
  setPermissionMode(state, enabled ? "on" : "off", ctx);
}

export function toggleWriteMode(state: WriteGateState, ctx: WriteStatusContext): void {
  togglePermissionMode(state, ctx);
}

export class WriteModeEditor extends CustomEditor {
  private readonly writeGateState: WriteGateState;

  private readonly styler: StatusStyler | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    state: WriteGateState,
    styler?: StatusStyler,
  ) {
    super(tui, theme, keybindings);
    this.writeGateState = state;
    this.styler = styler;
    this.writeGateState.activeTui = tui;
  }

  override render(width: number): string[] {
    return applyWriteModeLabel(super.render(width), width, this.writeGateState.mode, this.styler);
  }
}
