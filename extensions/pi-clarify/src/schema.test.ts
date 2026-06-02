import { describe, expect, test } from "vitest";
import { ASK_USER_CUSTOM_VALUE, buildDetails, formatAnswer, validateAskUserParams } from "./schema";
import type { AskUserParams } from "./schema";

function validSelect(overrides?: Partial<AskUserParams>): AskUserParams {
  return {
    type: "select",
    message: "Which change should I make first?",
    options: [
      { value: "docs", label: "Docs", hint: "Lowest risk" },
      { value: "runtime", label: "Runtime", hint: "Higher impact" },
    ],
    ...overrides,
  };
}

describe("pi-clarify schema helpers", () => {
  test("accepts valid select, text, and confirm prompts", () => {
    expect(validateAskUserParams(validSelect())).toEqual({ ok: true });
    expect(validateAskUserParams({ type: "text", message: "What should I call it?" })).toEqual({
      ok: true,
    });
    expect(validateAskUserParams({ type: "confirm", message: "Proceed?" })).toEqual({ ok: true });
  });

  test("rejects empty and secret-like prompts", () => {
    expect(validateAskUserParams({ type: "text", message: "   " })).toEqual({
      ok: false,
      reason: "Clarification message must not be empty.",
    });
    expect(validateAskUserParams({ type: "text", message: "What is your API key?" })).toEqual({
      ok: false,
      reason: "Clarification prompts must not ask for secrets or credentials.",
    });
  });

  test("validates select options", () => {
    expect(
      validateAskUserParams(validSelect({ options: [{ value: "one", label: "One" }] })),
    ).toEqual({
      ok: false,
      reason: "Select prompts require at least two options.",
    });

    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "same", label: "First" },
            { value: "same", label: "Second" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Duplicate select option value: same" });

    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: ASK_USER_CUSTOM_VALUE, label: "Reserved" },
            { value: "other", label: "Other" },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      reason: `${ASK_USER_CUSTOM_VALUE} is reserved for custom answers.`,
    });
  });

  test("rejects non-select options and confirm custom answers", () => {
    expect(
      validateAskUserParams({
        type: "text",
        message: "Name?",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ).toEqual({ ok: false, reason: "Only select prompts may include options." });

    expect(
      validateAskUserParams({ type: "confirm", message: "Proceed?", allowCustom: true }),
    ).toEqual({
      ok: false,
      reason: "Confirm prompts cannot allow custom answers.",
    });
  });

  test("rejects \u003e6 options", () => {
    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "1", label: "One" },
            { value: "2", label: "Two" },
            { value: "3", label: "Three" },
            { value: "4", label: "Four" },
            { value: "5", label: "Five" },
            { value: "6", label: "Six" },
            { value: "7", label: "Seven" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Select prompts support at most six options." });
  });

  test("rejects blank option values and labels", () => {
    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "", label: "One" },
            { value: "two", label: "Two" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Select option values and labels must not be empty." });

    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "one", label: "" },
            { value: "two", label: "Two" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Select option values and labels must not be empty." });

    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "   ", label: "One" },
            { value: "two", label: "Two" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Select option values and labels must not be empty." });
  });

  test("rejects secret words in option hints", () => {
    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "docs", label: "Docs", hint: "No password needed" },
            { value: "runtime", label: "Runtime" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Select options must not ask for secrets or credentials." });
  });

  test("rejects secret words in option values and labels", () => {
    expect(
      validateAskUserParams(
        validSelect({
          options: [
            { value: "api-key", label: "API Key" },
            { value: "other", label: "Other" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "Select options must not ask for secrets or credentials." });
  });

  test("rejects secret words in Chinese", () => {
    expect(validateAskUserParams({ type: "text", message: "请输入密码" })).toEqual({
      ok: false,
      reason: "Clarification prompts must not ask for secrets or credentials.",
    });
  });

  test("builds details and formats answers", () => {
    const params: AskUserParams = { type: "confirm", message: "Proceed?" };
    const details = buildDetails(params, "answered", { type: "confirm", value: true });

    expect(details).toEqual({
      status: "answered",
      promptType: "confirm",
      message: "Proceed?",
      answer: { type: "confirm", value: true },
    });
    expect(formatAnswer({ type: "confirm", value: true })).toBe("User answered: yes");
    expect(formatAnswer({ type: "text", value: "Ship it" })).toBe("User answered: Ship it");
    expect(formatAnswer({ type: "custom", value: "Something else" })).toBe(
      "User wrote: Something else",
    );
    expect(formatAnswer({ type: "select", value: "docs", label: "Docs" })).toBe(
      "User selected: Docs",
    );
  });
});
