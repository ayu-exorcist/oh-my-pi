import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { AskUserParamsSchema, buildDetails, formatAnswer, validateAskUserParams } from "./schema";
import type { AskUserDetails, AskUserParams } from "./schema";
import { askWithClarifyUi } from "./ui";

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
    "For ask_user select prompts, provide 2-6 concrete options with concise trade-offs and include allowCustom when the user's preference may not be listed.",
    "Do not use ask_user to request passwords, API keys, tokens, cookies, private keys, or other credentials.",
  ];
}

export default function clarify(pi: ExtensionAPI) {
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

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

      const answer = await askWithClarifyUi(params, ctx);
      const details = answer
        ? buildDetails(params, "answered", answer)
        : buildDetails(
            params,
            "cancelled",
            undefined,
            "User cancelled or submitted an empty answer.",
          );
      appendClarifyEntry(pi, details);
      return toolResult(details);
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
        ctx.ui.notify("Pi Clarify: enabled\nSupported prompt types: select, text, confirm", "info");
        return;
      }

      if (trimmed === "demo") {
        const params: AskUserParams = {
          type: "select",
          message: "What should Pi Clarify demo return?",
          options: [
            { value: "continue", label: "Continue", hint: "Return a selected answer" },
            { value: "cancel", label: "Cancel", hint: "Use Esc to test cancellation instead" },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderClarifyCall(args: unknown, theme: Pick<Theme, "fg" | "bold">) {
  const title = theme.fg("toolTitle", theme.bold("ask_user "));
  const message = isRecord(args) && typeof args.message === "string" ? args.message : "";
  return new Text(title + theme.fg("muted", message), 0, 0);
}

export function renderClarifyResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  theme: Pick<Theme, "fg">,
) {
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
export { askWithClarifyUi } from "./ui";
export type { AskUserAnswer, AskUserDetails, AskUserParams, PromptOption } from "./schema";
