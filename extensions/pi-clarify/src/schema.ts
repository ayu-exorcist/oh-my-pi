import { Type } from "typebox";
import type { Static } from "typebox";

export const ASK_USER_CUSTOM_VALUE = "__custom__";

const SECRET_WORDS = [
  "api key",
  "apikey",
  "auth token",
  "cookie",
  "credential",
  "password",
  "private key",
  "secret",
  "token",
  "密码",
  "密钥",
  "私钥",
  "令牌",
  "凭证",
] as const;

export const PromptOptionSchema = Type.Object({
  value: Type.String({ description: "Stable value returned when this option is selected" }),
  label: Type.String({ description: "Human-readable option label" }),
  hint: Type.Optional(Type.String({ description: "Optional short trade-off or explanation" })),
  disabled: Type.Optional(
    Type.Boolean({ description: "Whether this option should be shown as unavailable" }),
  ),
});

export const AskUserParamsSchema = Type.Object({
  type: Type.Union(
    [
      Type.Literal("select"),
      Type.Literal("multiselect"),
      Type.Literal("text"),
      Type.Literal("confirm"),
    ],
    {
      description: "Prompt type to show to the user",
    },
  ),
  message: Type.String({ description: "Exactly one answerable question to ask the user" }),
  options: Type.Optional(
    Type.Array(PromptOptionSchema, {
      description:
        "Options for select/multiselect prompts. Required when type is select or multiselect.",
    }),
  ),
  allowCustom: Type.Optional(
    Type.Boolean({ description: "For select prompts, include a custom text answer option" }),
  ),
  customLabel: Type.Optional(
    Type.String({ description: "Label for the custom text option when allowCustom is true" }),
  ),
  placeholder: Type.Optional(Type.String({ description: "Placeholder for text/custom input" })),
  defaultValue: Type.Optional(
    Type.Boolean({ description: "Initial value for confirm prompts. Defaults to false." }),
  ),
});

export type PromptOption = Static<typeof PromptOptionSchema>;
export type AskUserParams = Static<typeof AskUserParamsSchema>;

export type AskUserAnswer =
  | { readonly type: "select"; readonly value: string; readonly label: string }
  | {
      readonly type: "multiselect";
      readonly values: ReadonlyArray<{ readonly value: string; readonly label: string }>;
    }
  | { readonly type: "custom"; readonly value: string }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "confirm"; readonly value: boolean };

export interface AskUserDetails {
  readonly status: "answered" | "cancelled" | "unavailable" | "rejected";
  readonly promptType: AskUserParams["type"];
  readonly message: string;
  readonly answer?: AskUserAnswer;
  readonly reason?: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

function hasSecretWord(value: string): boolean {
  const lower = value.toLocaleLowerCase();
  return SECRET_WORDS.some((word) => lower.includes(word));
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function validateAskUserParams(params: AskUserParams): ValidationResult {
  if (isBlank(params.message)) {
    return { ok: false, reason: "Clarification message must not be empty." };
  }

  if (hasSecretWord(params.message)) {
    return { ok: false, reason: "Clarification prompts must not ask for secrets or credentials." };
  }

  if (params.type === "select" || params.type === "multiselect") {
    const options = params.options ?? [];
    if (options.length < 2) {
      return { ok: false, reason: "Select and multiselect prompts require at least two options." };
    }
    if (options.length > 6) {
      return { ok: false, reason: "Select and multiselect prompts support at most six options." };
    }

    const values = new Set<string>();
    for (const option of options) {
      if (isBlank(option.value) || isBlank(option.label)) {
        return { ok: false, reason: "Option values and labels must not be empty." };
      }
      if (option.value === ASK_USER_CUSTOM_VALUE) {
        return { ok: false, reason: `${ASK_USER_CUSTOM_VALUE} is reserved for custom answers.` };
      }
      if (values.has(option.value)) {
        return { ok: false, reason: `Duplicate option value: ${option.value}` };
      }
      values.add(option.value);

      const secretText = `${option.value} ${option.label} ${option.hint ?? ""}`;
      if (hasSecretWord(secretText)) {
        return { ok: false, reason: "Options must not ask for secrets or credentials." };
      }
    }
  }

  if (params.type !== "select" && params.type !== "multiselect" && params.options) {
    return { ok: false, reason: "Only select and multiselect prompts may include options." };
  }

  if (params.type === "confirm" && params.allowCustom) {
    return { ok: false, reason: "Confirm prompts cannot allow custom answers." };
  }

  if (params.type === "multiselect" && params.allowCustom) {
    return { ok: false, reason: "Multiselect prompts cannot allow custom answers." };
  }

  return { ok: true };
}

export function buildDetails(
  params: AskUserParams,
  status: AskUserDetails["status"],
  answer?: AskUserAnswer,
  reason?: string,
): AskUserDetails {
  const base = {
    status,
    promptType: params.type,
    message: params.message,
  };

  return {
    ...base,
    ...(answer ? { answer } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function formatAnswer(answer: AskUserAnswer): string {
  if (answer.type === "select") return `User selected: ${answer.label}`;
  if (answer.type === "multiselect")
    return `User selected: ${answer.values.map((v) => v.label).join(", ")}`;
  if (answer.type === "custom") return `User wrote: ${answer.value}`;
  if (answer.type === "text") return `User answered: ${answer.value}`;
  return `User answered: ${answer.value ? "yes" : "no"}`;
}
