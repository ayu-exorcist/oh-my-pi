import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";
import type { AskUserAnswer, AskUserParams, PromptOption } from "./schema";

const DEFAULT_CUSTOM_LABEL = "Custom...";

interface DisplayOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly custom?: boolean;
  readonly confirmValue?: boolean;
}

function withOptionalFields(
  base: { readonly value: string; readonly label: string },
  option: Pick<DisplayOption, "hint" | "disabled" | "custom" | "confirmValue">,
): DisplayOption {
  return {
    ...base,
    ...(option.hint ? { hint: option.hint } : {}),
    ...(option.disabled ? { disabled: true } : {}),
    ...(option.custom ? { custom: true } : {}),
    ...(typeof option.confirmValue === "boolean" ? { confirmValue: option.confirmValue } : {}),
  };
}

function selectOptions(params: AskUserParams): DisplayOption[] {
  const options = (params.options ?? []).map((option: PromptOption) =>
    withOptionalFields(
      {
        value: option.value,
        label: option.label,
      },
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
      {
        value: "__custom__",
        label: params.customLabel?.trim() || DEFAULT_CUSTOM_LABEL,
      },
      { custom: true },
    ),
  ];
}

function confirmOptions(defaultValue: boolean): DisplayOption[] {
  return [
    withOptionalFields(
      { value: "yes", label: "Yes" },
      { ...(defaultValue ? { hint: "default" } : {}), confirmValue: true },
    ),
    withOptionalFields(
      { value: "no", label: "No" },
      { ...(!defaultValue ? { hint: "default" } : {}), confirmValue: false },
    ),
  ];
}

function promptOptions(params: AskUserParams): DisplayOption[] {
  if (params.type === "confirm") return confirmOptions(params.defaultValue === true);
  if (params.type === "select") return selectOptions(params);
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

function answerFromOption(option: DisplayOption): AskUserAnswer | undefined {
  if (typeof option.confirmValue === "boolean") {
    return { type: "confirm", value: option.confirmValue };
  }
  if (option.custom) return undefined;
  return { type: "select", value: option.value, label: option.label };
}

function addTruncated(lines: string[], width: number, text: string): void {
  lines.push(truncateToWidth(text, width));
}

export async function askWithClarifyUi(
  params: AskUserParams,
  ctx: ExtensionContext,
): Promise<AskUserAnswer | undefined> {
  return ctx.ui.custom<AskUserAnswer | undefined>(
    (tui, theme, _keybindings, done) => {
      const options = promptOptions(params);
      let selectedIndex = firstEnabledIndex(
        options,
        params.type === "confirm" && params.defaultValue === false ? 1 : 0,
      );
      let inputMode = params.type === "text";
      let cachedLines: string[] | undefined;
      let focused = false;
      const editor = new Editor(tui, buildEditorTheme(ctx));

      function refresh(): void {
        cachedLines = undefined;
        tui.requestRender();
      }

      function submitText(value: string): void {
        const trimmed = value.trim();
        if (!trimmed) {
          done(undefined);
          return;
        }

        done(
          params.type === "select"
            ? { type: "custom", value: trimmed }
            : { type: "text", value: trimmed },
        );
      }

      editor.onSubmit = submitText;

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

      function handleSelectEnter(): void {
        const selected = options[selectedIndex];
        if (!selected || selected.disabled) return;

        if (selected.custom) {
          inputMode = true;
          editor.setText("");
          refresh();
          return;
        }

        done(answerFromOption(selected));
      }

      function handleInput(data: string): void {
        if (inputMode) {
          if (matchesKey(data, Key.escape)) {
            if (params.type === "select") {
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

        if (matchesKey(data, Key.up)) {
          moveSelection(-1);
          return;
        }
        if (matchesKey(data, Key.down)) {
          moveSelection(1);
          return;
        }
        if (matchesKey(data, Key.enter)) {
          handleSelectEnter();
          return;
        }
        if (matchesKey(data, Key.escape)) {
          done(undefined);
        }
      }

      function renderInput(width: number, lines: string[]): void {
        const label = params.type === "select" ? "Custom answer:" : "Your answer:";
        addTruncated(lines, width, theme.fg("muted", `│ ${label}`));
        for (const line of editor.render(Math.max(1, width - 2))) {
          addTruncated(lines, width, `│ ${line}`);
        }
      }

      function renderOptions(width: number, lines: string[]): void {
        for (let index = 0; index < options.length; index++) {
          const option = options[index];
          if (!option) continue;

          const isSelected = index === selectedIndex;
          const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
          const label = option.disabled
            ? theme.fg("dim", `${option.label} (disabled)`)
            : isSelected
              ? theme.fg("accent", option.label)
              : theme.fg("text", option.label);
          addTruncated(lines, width, `│ ${prefix}${label}`);

          if (option.hint) {
            addTruncated(lines, width, `│    ${theme.fg("muted", option.hint)}`);
          }
        }
      }

      function render(width: number): string[] {
        if (cachedLines) return cachedLines;

        const lines: string[] = [];
        const horizontal = theme.fg("accent", "─".repeat(Math.max(1, width)));
        addTruncated(lines, width, horizontal);
        addTruncated(
          lines,
          width,
          `${theme.fg("accent", "◇")} ${theme.fg("text", params.message)}`,
        );
        lines.push("");

        if (inputMode) {
          renderInput(width, lines);
        } else {
          renderOptions(width, lines);
        }

        lines.push("");
        const help = inputMode
          ? params.type === "select"
            ? "Enter submit • Esc back"
            : "Enter submit • Esc cancel"
          : "↑↓ navigate • Enter select • Esc cancel";
        addTruncated(lines, width, theme.fg("dim", help));
        addTruncated(lines, width, horizontal);

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
    },
    {
      overlay: true,
      overlayOptions: {
        width: "70%",
        minWidth: 50,
        maxHeight: "80%",
        margin: 1,
      },
    },
  );
}
