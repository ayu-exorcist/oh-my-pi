import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isRecord } from "@ayulab/runtime-core";
import { AskUserParamsSchema, buildDetails, formatAnswer, validateAskUserParams } from "./schema";
import type { AskUserDetails, AskUserParams, PromptOption } from "./schema";
import { askWithClarifyUi, cancelClarifyInput, handleClarifyInput, isClarifyPending } from "./ui";

export function appendClarifyEntry(pi: ExtensionAPI, details: AskUserDetails): void {
  pi.appendEntry("pi-clarify.answer", {
    status: details.status,
    promptType: details.promptType,
    message: details.message,
    answer: details.answer,
    reason: details.reason,
    timestamp: new Date().toISOString(),
  });
}

export function resultText(details: AskUserDetails): string {
  if (details.status === "answered" && details.answer) return formatAnswer(details.answer);
  if (details.status === "cancelled") return "User cancelled the clarification prompt.";
  if (details.status === "unavailable") return details.reason ?? "Clarification UI is unavailable.";
  return details.reason ?? "Clarification prompt was rejected.";
}

export function toolResult(details: AskUserDetails) {
  return {
    content: [{ type: "text" as const, text: resultText(details) }],
    details,
  };
}

export function buildPromptGuidelines(): string[] {
  return [
    "Use ask_user when a missing decision would materially affect files, scope, public APIs, package metadata, safety posture, or release behavior.",
    "ask_user accepts exactly one prompt per tool call; ask the next question only after receiving the previous answer.",
    "Supported prompt types: select (single choice), multiselect (multiple choices), text (free-form), confirm (yes/no).",
    "For select and multiselect prompts, provide 2-6 concrete options with concise trade-offs. Use allowCustom for select when the user's preference may not be listed.",
    "Do not use ask_user to request passwords, API keys, tokens, cookies, private keys, or other credentials.",
  ];
}

const DEFAULT_CUSTOM_LABEL = "Custom...";

type ClarifyRenderType = AskUserParams["type"] | undefined;

interface ClarifyRenderParams {
  readonly type?: ClarifyRenderType;
  readonly message?: string;
  readonly options?: readonly PromptOption[];
  readonly allowCustom?: boolean;
  readonly customLabel?: string;
}

function buildClackPrompt(params: ClarifyRenderParams, theme: Pick<Theme, "fg">): string {
  const lines: string[] = [];
  const type =
    params.type === "select" ||
    params.type === "multiselect" ||
    params.type === "text" ||
    params.type === "confirm"
      ? params.type
      : "text";
  const message = typeof params.message === "string" ? params.message : "";
  const allowCustom = params.allowCustom === true;
  const customLabel = typeof params.customLabel === "string" ? params.customLabel.trim() : "";
  const options = Array.isArray(params.options)
    ? params.options.filter((option): option is PromptOption => isPromptOption(option))
    : [];

  lines.push(theme.fg("accent", "◇  ") + theme.fg("text", message));
  lines.push(theme.fg("dim", "│"));

  if (type === "select" || type === "multiselect") {
    for (const [i, opt] of options.entries()) {
      const num = `${i + 1}.`;
      lines.push(theme.fg("dim", "│  ") + theme.fg("text", `${num} ${opt.label}`));
      if (opt.hint) {
        lines.push(theme.fg("dim", "│     ") + theme.fg("muted", opt.hint));
      }
    }
    if (allowCustom && type === "select") {
      lines.push(
        theme.fg("dim", "│  ") + theme.fg("text", `Custom: ${customLabel || DEFAULT_CUSTOM_LABEL}`),
      );
    }
  } else if (type === "confirm") {
    lines.push(theme.fg("dim", "│  ") + theme.fg("text", "y/yes or n/no"));
  }

  lines.push(theme.fg("dim", "│"));

  let hint = "";
  if (type === "select") {
    hint = allowCustom
      ? "Reply with option number or custom text. Empty message to cancel."
      : "Reply with option number. Empty message to cancel.";
  } else if (type === "multiselect") {
    hint = "Reply with numbers (e.g. 1 2 3) or 'all'. Empty message to cancel.";
  } else if (type === "confirm") {
    hint = "Reply with y/yes or n/no. Empty message to cancel.";
  } else {
    hint = "Reply with your answer. Empty message to cancel.";
  }
  lines.push(theme.fg("dim", "│  ") + theme.fg("muted", hint));

  return lines.join("\n");
}

export default function clarify(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (!isClarifyPending()) return { action: "continue" };
    const result = handleClarifyInput(event.text);
    if (result.handled) {
      if (!result.valid) {
        ctx.ui.notify(
          "Invalid input. Please try again or send empty message to cancel.",
          "warning",
        );
      }
      return { action: "handled" };
    }
    return { action: "continue" };
  });

  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user exactly one structured clarification question via Pi UI. Use for decisions needed before acting; do not ask for secrets.",
    promptSnippet:
      "Ask the user one structured clarification question when a material decision is missing",
    promptGuidelines: buildPromptGuidelines(),
    parameters: AskUserParamsSchema,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const validation = validateAskUserParams(params);
      if (!validation.ok) {
        const details = buildDetails(params, "rejected", undefined, validation.reason);
        appendClarifyEntry(pi, details);
        return toolResult(details);
      }

      if (!ctx.hasUI) {
        const details = buildDetails(
          params,
          "unavailable",
          undefined,
          "Clarification UI is unavailable in this mode. Ask the question in plain text instead.",
        );
        appendClarifyEntry(pi, details);
        return toolResult(details);
      }

      return new Promise((resolve) => {
        let resolved = false;

        const doResolve = (answer: import("./schema").AskUserAnswer | undefined) => {
          if (resolved) return;
          resolved = true;
          const details = answer
            ? buildDetails(params, "answered", answer)
            : buildDetails(
                params,
                "cancelled",
                undefined,
                "User cancelled or submitted an empty answer.",
              );
          appendClarifyEntry(pi, details);
          resolve(toolResult(details));
        };

        askWithClarifyUi(params, ctx)
          .then(doResolve)
          .catch(() => doResolve(undefined));

        if (signal) {
          if (signal.aborted) {
            cancelClarifyInput();
            doResolve(undefined);
          } else {
            const abortHandler = () => {
              signal.removeEventListener("abort", abortHandler);
              cancelClarifyInput();
              doResolve(undefined);
            };
            signal.addEventListener("abort", abortHandler);
          }
        }
      });
    },

    renderCall(args, theme) {
      return renderClarifyCall(args, theme);
    },

    renderResult(result, _options, theme) {
      return renderClarifyResult(result, theme);
    },
  });

  pi.registerCommand("clarify", {
    description: "Pi Clarify status and demo",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed || trimmed === "status") {
        ctx.ui.notify(
          "Pi Clarify: enabled\nSupported prompt types: select, multiselect, text, confirm",
          "info",
        );
        return;
      }

      if (trimmed === "demo") {
        const params: AskUserParams = {
          type: "select",
          message: "What should Pi Clarify demo return?",
          options: [
            { value: "continue", label: "Continue", hint: "Return a selected answer" },
            { value: "cancel", label: "Cancel", hint: "Send empty message to test cancellation" },
          ],
          allowCustom: true,
        };
        const answer = ctx.hasUI ? await askWithClarifyUi(params, ctx) : undefined;
        if (!answer) {
          ctx.ui.notify("Pi Clarify demo cancelled.", "warning");
          return;
        }
        ctx.ui.notify(formatAnswer(answer), "info");
        return;
      }

      ctx.ui.notify("Usage: /clarify status | /clarify demo", "warning");
    },
  });
}

function isPromptOption(value: unknown): value is PromptOption {
  return isRecord(value) && typeof value.value === "string" && typeof value.label === "string";
}

function isClarifyRenderParams(value: unknown): value is ClarifyRenderParams {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (
    type !== undefined &&
    type !== "select" &&
    type !== "multiselect" &&
    type !== "text" &&
    type !== "confirm"
  ) {
    return false;
  }
  return true;
}

export function renderClarifyCall(args: unknown, theme: Pick<Theme, "fg" | "bold">) {
  if (!isClarifyRenderParams(args)) return new Text("", 0, 0);
  const prompt = buildClackPrompt(args, theme);
  return new Text(prompt, 0, 0);
}

interface ClarifyToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly details?: unknown;
}

export function renderClarifyResult(result: ClarifyToolResult, theme: Pick<Theme, "fg">) {
  const details = result.details;
  if (!isRecord(details)) {
    const first = result.content[0];
    return new Text(first?.type === "text" ? first.text : "", 0, 0);
  }

  const status = typeof details.status === "string" ? details.status : undefined;
  const text = result.content[0];
  const content = text?.type === "text" ? text.text : "";
  if (status === "answered") return new Text(theme.fg("success", "✓ ") + String(content), 0, 0);
  if (status === "cancelled") return new Text(theme.fg("warning", String(content)), 0, 0);
  return new Text(theme.fg("error", String(content)), 0, 0);
}

export {
  ASK_USER_CUSTOM_VALUE,
  AskUserParamsSchema,
  buildDetails,
  formatAnswer,
  validateAskUserParams,
} from "./schema";
export { askWithClarifyUi, cancelClarifyInput, handleClarifyInput, isClarifyPending } from "./ui";
export type { AskUserAnswer, AskUserDetails, AskUserParams, PromptOption } from "./schema";
