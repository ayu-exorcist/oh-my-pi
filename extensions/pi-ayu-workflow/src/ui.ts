import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

export type StatusStyler = {
  fg?: (color: "accent", text: string) => string;
};

export type RenderTarget = Pick<TUI, "requestRender">;

export interface AyuState {
  writeEnabled: boolean;
  activeTui: RenderTarget | undefined;
}

export type WriteStatusContext = {
  ui?: {
    setStatus?: (key: string, value?: string) => void;
  };
};

export function buildWriteModeLabel(writeEnabled: boolean): string {
  return `Write Mode: ${writeEnabled ? "On" : "Off"}`;
}

export function buildHelpText(writeEnabled: boolean): string {
  return `Ayu workflow

${buildWriteModeLabel(writeEnabled)}

Write Mode:
  Off = discuss, plan, review, and inspect read-only; mutating tools are blocked
  On  = implement small verified changes; /ayu on <prompt> auto-turns Off after that run

Commands:
  /ayu [write] on|off [prompt]
                             Toggle Write Mode; with prompt after on, run it once then auto-Off
  /ayu status                Show current session Write Mode
  /ayu task <goal>           Discuss/plan: clarify scope and verification; no edits
  /ayu review [focus]        Review current git diff and decide whether more work is needed
  /ayu docs [scope]          Check README/docs/CHANGELOG sync need before editing docs
  /ayu release [scope]       Check release readiness; never publish/tag/push
  /ayu verify [criteria]     Summarize verification evidence after implementation
  /ayu audit [scope]         Audit project AI engineering setup using Ayu workflow
  /ayu help                  Show this help

Shortcut:
  Alt+S                      Toggle Write Mode for this session`;
}

export function buildStyledWriteModeLabel(writeEnabled: boolean, styler?: StatusStyler): string {
  const label = ` ${buildWriteModeLabel(writeEnabled)} `;
  return typeof styler?.fg === "function" ? styler.fg("accent", label) : label;
}

export function requestEditorRender(state: AyuState): void {
  state.activeTui?.requestRender();
}

export function setWriteStatus(state: AyuState, ctx: WriteStatusContext): void {
  ctx.ui?.setStatus?.("ayu-write-mode", undefined);
  requestEditorRender(state);
}

export function setWriteEnabled(state: AyuState, enabled: boolean, ctx: WriteStatusContext): void {
  state.writeEnabled = enabled;
  setWriteStatus(state, ctx);
}

export function toggleWriteMode(state: AyuState, ctx: WriteStatusContext): void {
  setWriteEnabled(state, !state.writeEnabled, ctx);
}

export function applyWriteModeLabel(
  lines: string[],
  width: number,
  writeEnabled: boolean,
  styler?: StatusStyler,
): string[] {
  if (lines.length === 0) return lines;

  const label = buildStyledWriteModeLabel(writeEnabled, styler);
  lines[0] =
    label +
    truncateToWidth(
      lines[0] ?? "",
      Math.max(0, width - buildWriteModeLabel(writeEnabled).length - 2),
      "",
    );
  return lines;
}

export class WriteModeEditor extends CustomEditor {
  private readonly ayuState: AyuState;

  private readonly styler: StatusStyler | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    state: AyuState,
    styler?: StatusStyler,
  ) {
    super(tui, theme, keybindings);
    this.ayuState = state;
    this.styler = styler;
    this.ayuState.activeTui = tui;
  }

  override render(width: number): string[] {
    return applyWriteModeLabel(super.render(width), width, this.ayuState.writeEnabled, this.styler);
  }
}
