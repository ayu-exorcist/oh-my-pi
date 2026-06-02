import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";
import type { AskUserAnswer, AskUserParams, PromptOption } from "./schema";

const DEFAULT_CUSTOM_LABEL = "Custom...";
const MIN_RENDER_WIDTH = 20;

interface DisplayOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly custom?: boolean;
}

function withOptionalFields(
  base: { readonly value: string; readonly label: string },
  option: Pick<DisplayOption, "hint" | "disabled" | "custom">,
): DisplayOption {
  return {
    ...base,
    ...(option.hint ? { hint: option.hint } : {}),
    ...(option.disabled ? { disabled: true } : {}),
    ...(option.custom ? { custom: true } : {}),
  };
}

function selectOptions(params: AskUserParams): DisplayOption[] {
  const options = (params.options ?? []).map((option: PromptOption) =>
    withOptionalFields(
      { value: option.value, label: option.label },
      {
        ...(option.hint ? { hint: option.hint } : {}),
        ...(option.disabled ? { disabled: true } : {}),
      },
    ),
  );

  if (!params.allowCustom) return options;

  return [
    ...options,
    withOptionalFields(
      { value: "__custom__", label: params.customLabel?.trim() || DEFAULT_CUSTOM_LABEL },
      { custom: true },
    ),
  ];
}

function promptOptions(params: AskUserParams): DisplayOption[] {
  if (params.type === "select") return selectOptions(params);
  if (params.type === "multiselect") {
    return (params.options ?? []).map((option: PromptOption) =>
      withOptionalFields(
        { value: option.value, label: option.label },
        {
          ...(option.hint ? { hint: option.hint } : {}),
          ...(option.disabled ? { disabled: true } : {}),
        },
      ),
    );
  }
  return [];
}

function buildEditorTheme(ctx: ExtensionContext): EditorTheme {
  return {
    borderColor: (text: string) => ctx.ui.theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text: string) => ctx.ui.theme.fg("accent", text),
      selectedText: (text: string) => ctx.ui.theme.fg("accent", text),
      description: (text: string) => ctx.ui.theme.fg("muted", text),
      scrollInfo: (text: string) => ctx.ui.theme.fg("dim", text),
      noMatch: (text: string) => ctx.ui.theme.fg("warning", text),
    },
  };
}

function firstEnabledIndex(options: readonly DisplayOption[], preferred: number): number {
  const preferredOption = options[preferred];
  if (preferredOption && !preferredOption.disabled) return preferred;

  const found = options.findIndex((option) => !option.disabled);
  return found >= 0 ? found : 0;
}

function addTruncated(lines: string[], width: number, text: string): void {
  lines.push(truncateToWidth(text, width));
}

export async function askWithClarifyUi(
  params: AskUserParams,
  ctx: ExtensionContext,
): Promise<AskUserAnswer | undefined> {
  return ctx.ui.custom<AskUserAnswer | undefined>((tui, theme, _keybindings, done) => {
    let cachedLines: string[] | undefined;
    let focused = false;

    const options = promptOptions(params);
    let selectedIndex = firstEnabledIndex(options, 0);
    const selectedIndices = new Set<number>();

    let confirmIndex = params.defaultValue === true ? 0 : 1;

    let inputMode = params.type === "text";
    const editor = new Editor(tui, buildEditorTheme(ctx));

    function refresh(): void {
      cachedLines = undefined;
      tui.requestRender();
    }

    function moveSelection(delta: number): void {
      if (options.length === 0) return;

      let next = selectedIndex;
      for (let step = 0; step < options.length; step++) {
        next = (next + delta + options.length) % options.length;
        const candidate = options[next];
        if (candidate && !candidate.disabled) {
          selectedIndex = next;
          refresh();
          return;
        }
      }
    }

    function moveToIndex(target: number): void {
      if (target >= 0 && target < options.length && !options[target]?.disabled) {
        selectedIndex = target;
        refresh();
      }
    }

    function toggleMultiselect(): void {
      if (params.type !== "multiselect") return;
      const opt = options[selectedIndex];
      if (!opt || opt.disabled) return;

      if (selectedIndices.has(selectedIndex)) {
        selectedIndices.delete(selectedIndex);
      } else {
        selectedIndices.add(selectedIndex);
      }
      refresh();
    }

    function submitText(value: string): void {
      const trimmed = value.trim();
      if (!trimmed) {
        done(undefined);
        return;
      }

      done(
        params.type === "select" || params.type === "multiselect"
          ? { type: "custom", value: trimmed }
          : { type: "text", value: trimmed },
      );
    }

    editor.onSubmit = submitText;

    function handleSelectEnter(): void {
      const selected = options[selectedIndex];
      if (!selected || selected.disabled) return;

      if (selected.custom) {
        inputMode = true;
        editor.setText("");
        refresh();
        return;
      }

      if (params.type === "multiselect") {
        toggleMultiselect();
        return;
      }

      done({ type: "select", value: selected.value, label: selected.label });
    }

    function handleConfirmEnter(): void {
      done({ type: "confirm", value: confirmIndex === 0 });
    }

    function handleMultiselectEnter(): void {
      const values = Array.from(selectedIndices)
        .sort((a, b) => a - b)
        .reduce<Array<{ value: string; label: string }>>((acc, i) => {
          const opt = options[i];
          if (opt) acc.push({ value: opt.value, label: opt.label });
          return acc;
        }, []);
      done({ type: "multiselect", values });
    }

    function handleInput(data: string): void {
      if (inputMode) {
        if (matchesKey(data, Key.escape)) {
          if (params.type === "select" || params.type === "multiselect") {
            inputMode = false;
            editor.setText("");
            refresh();
            return;
          }
          done(undefined);
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      if (params.type === "confirm") {
        if (
          matchesKey(data, Key.left) ||
          matchesKey(data, Key.up) ||
          matchesKey(data, Key.right) ||
          matchesKey(data, Key.down)
        ) {
          confirmIndex = confirmIndex === 0 ? 1 : 0;
          refresh();
          return;
        }
        if (data === "y" || data === "Y") {
          confirmIndex = 0;
          refresh();
          return;
        }
        if (data === "n" || data === "N") {
          confirmIndex = 1;
          refresh();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          handleConfirmEnter();
          return;
        }
        if (matchesKey(data, Key.escape)) {
          done(undefined);
          return;
        }
        return;
      }

      if (params.type === "select" || params.type === "multiselect") {
        if (matchesKey(data, Key.up)) {
          moveSelection(-1);
          return;
        }
        if (matchesKey(data, Key.down)) {
          moveSelection(1);
          return;
        }
        if (matchesKey(data, Key.space) && params.type === "multiselect") {
          toggleMultiselect();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          if (params.type === "multiselect") {
            handleMultiselectEnter();
          } else {
            handleSelectEnter();
          }
          return;
        }
        if (matchesKey(data, Key.escape)) {
          done(undefined);
          return;
        }
        const num = Number.parseInt(data, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= 6) {
          moveToIndex(num - 1);
          return;
        }
        return;
      }

      if (matchesKey(data, Key.escape)) {
        done(undefined);
      }
    }

    function renderTitle(width: number, lines: string[]): void {
      const prefix = theme.fg("accent", "◆  ");
      const contentWidth = Math.max(1, width - 3);
      const wrapped = wrapTextWithAnsi(params.message, contentWidth);
      for (let i = 0; i < wrapped.length; i++) {
        const linePrefix = i === 0 ? prefix : "   ";
        addTruncated(lines, width, linePrefix + wrapped[i]);
      }
    }

    function renderSelectOptions(width: number, lines: string[]): void {
      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        if (!option) continue;

        const isFocused = i === selectedIndex;
        const num = `${i + 1}.`;
        const prefix = isFocused ? theme.fg("accent", "● ") : theme.fg("dim", "○ ");
        const label = option.disabled
          ? theme.fg("dim", option.label)
          : isFocused
            ? theme.fg("accent", option.label)
            : theme.fg("text", option.label);
        addTruncated(lines, width, `  ${prefix}${num} ${label}`);

        if (option.hint && width >= 40) {
          const hint = isFocused ? theme.fg("muted", option.hint) : theme.fg("dim", option.hint);
          addTruncated(lines, width, `      ${hint}`);
        }
      }
    }

    function renderMultiselectOptions(width: number, lines: string[]): void {
      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        if (!option) continue;

        const isFocused = i === selectedIndex;
        const isChecked = selectedIndices.has(i);
        const num = `${i + 1}.`;
        const check = isChecked ? theme.fg("accent", "[x]") : theme.fg("dim", "[ ]");
        const label = option.disabled
          ? theme.fg("dim", option.label)
          : isFocused
            ? theme.fg("accent", option.label)
            : theme.fg("text", option.label);
        addTruncated(lines, width, `  ${check} ${num} ${label}`);

        if (option.hint && width >= 40) {
          const hint = isFocused ? theme.fg("muted", option.hint) : theme.fg("dim", option.hint);
          addTruncated(lines, width, `      ${hint}`);
        }
      }
    }

    function renderConfirm(width: number, lines: string[]): void {
      const yesBullet = confirmIndex === 0 ? theme.fg("accent", "●") : theme.fg("dim", "○");
      const noBullet = confirmIndex === 1 ? theme.fg("accent", "●") : theme.fg("dim", "○");
      const yesLabel = confirmIndex === 0 ? theme.fg("accent", "Yes") : theme.fg("text", "Yes");
      const noLabel = confirmIndex === 1 ? theme.fg("accent", "No") : theme.fg("text", "No");

      if (width < 35) {
        addTruncated(lines, width, `    ${yesBullet} 1. ${yesLabel}`);
        addTruncated(lines, width, `    ${noBullet} 2. ${noLabel}`);
      } else {
        addTruncated(
          lines,
          width,
          `    ${yesBullet} 1. ${yesLabel}      ${noBullet} 2. ${noLabel}`,
        );
      }
    }

    function renderInput(width: number, lines: string[]): void {
      const label =
        params.type === "select" || params.type === "multiselect" ? "Custom answer" : "Your answer";
      addTruncated(lines, width, theme.fg("muted", `  ${label}:`));
      for (const line of editor.render(Math.max(1, width - 4))) {
        addTruncated(lines, width, `  ${line}`);
      }
    }

    function renderHelp(width: number, lines: string[]): void {
      let help = "";
      if (inputMode) {
        help =
          params.type === "select" || params.type === "multiselect"
            ? "Enter submit · Esc back"
            : "Enter submit · Esc cancel";
      } else if (params.type === "confirm") {
        help =
          width < 40
            ? "←→ · y/n · Enter · Esc"
            : "←→ switch · y/n jump · Enter confirm · Esc cancel";
      } else if (params.type === "multiselect") {
        help =
          width < 40
            ? "↑↓ · space · Enter · Esc"
            : "↑↓ navigate · space toggle · Enter confirm · Esc cancel";
      } else if (params.type === "select") {
        help =
          width < 40
            ? "↑↓ · 1-6 · Enter · Esc"
            : "↑↓ navigate · 1-6 jump · Enter confirm · Esc cancel";
      } else {
        help = "Enter submit · Esc cancel";
      }
      lines.push("");
      lines.push(theme.fg("dim", `  ${help}`));
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;

      if (width < MIN_RENDER_WIDTH) {
        return [theme.fg("warning", "⚠  Terminal too narrow — please resize")];
      }

      const lines: string[] = [];

      renderTitle(width, lines);
      lines.push("");

      if (inputMode) {
        renderInput(width, lines);
      } else if (params.type === "confirm") {
        renderConfirm(width, lines);
      } else if (params.type === "multiselect") {
        renderMultiselectOptions(width, lines);
      } else if (params.type === "select") {
        renderSelectOptions(width, lines);
      }

      renderHelp(width, lines);

      cachedLines = lines;
      return lines;
    }

    return {
      get focused() {
        return focused;
      },
      set focused(value: boolean) {
        focused = value;
        editor.focused = value;
      },
      render,
      invalidate() {
        cachedLines = undefined;
        editor.invalidate();
      },
      handleInput,
    };
  });
}
