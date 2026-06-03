import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskUserAnswer, AskUserParams } from "./schema";

interface PendingClarification {
  readonly params: AskUserParams;
  readonly resolve: (answer: AskUserAnswer | undefined) => void;
}

let pending: PendingClarification | undefined;

export function isClarifyPending(): boolean {
  return !!pending;
}

export function cancelClarifyInput(): void {
  if (!pending) return;
  pending.resolve(undefined);
  pending = undefined;
}

export function handleClarifyInput(text: string): { handled: boolean; valid: boolean } {
  if (!pending) return { handled: false, valid: false };

  const trimmed = text.trim();
  if (!trimmed) {
    pending.resolve(undefined);
    pending = undefined;
    return { handled: true, valid: true };
  }

  const answer = parseUserInput(trimmed, pending.params);
  if (answer) {
    pending.resolve(answer);
    pending = undefined;
    return { handled: true, valid: true };
  }

  return { handled: true, valid: false };
}

export function askWithClarifyUi(
  params: AskUserParams,
  ctx: ExtensionContext,
): Promise<AskUserAnswer | undefined> {
  if (!ctx.hasUI) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    pending = { params, resolve };
  });
}

function parseUserInput(text: string, params: AskUserParams): AskUserAnswer | undefined {
  if (params.type === "select") return parseSelectInput(text, params);
  if (params.type === "multiselect") return parseMultiselectInput(text, params);
  if (params.type === "confirm") return parseConfirmInput(text);
  if (params.type === "text") return { type: "text", value: text };
  return undefined;
}

function parseSelectInput(text: string, params: AskUserParams): AskUserAnswer | undefined {
  const options = params.options ?? [];

  if (/^\d+$/.test(text)) {
    const num = Number.parseInt(text, 10);
    const opt = options[num - 1];
    if (opt && !opt.disabled) return { type: "select", value: opt.value, label: opt.label };
    return undefined;
  }

  if (params.allowCustom) {
    return { type: "custom", value: text };
  }

  return undefined;
}

function parseMultiselectInput(text: string, params: AskUserParams): AskUserAnswer | undefined {
  const options = params.options ?? [];

  if (text.toLowerCase() === "all") {
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return undefined;
    return {
      type: "multiselect",
      values: enabled.map((o) => ({ value: o.value, label: o.label })),
    };
  }

  const seen = new Set<number>();
  const indices = text
    .split(/[\s,]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && !seen.has(n) && seen.add(n));

  const values = indices
    .filter((n) => n >= 1 && n <= options.length)
    .map((n) => options[n - 1])
    .filter((opt): opt is NonNullable<typeof opt> => !!opt && !opt.disabled)
    .map((opt) => ({ value: opt.value, label: opt.label }));

  if (values.length === 0) return undefined;
  return { type: "multiselect", values };
}

function parseConfirmInput(text: string): AskUserAnswer | undefined {
  const lower = text.toLowerCase();
  if (lower === "y" || lower === "yes") return { type: "confirm", value: true };
  if (lower === "n" || lower === "no") return { type: "confirm", value: false };
  return undefined;
}
