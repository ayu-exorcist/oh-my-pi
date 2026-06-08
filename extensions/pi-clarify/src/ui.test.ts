import { afterEach, describe, expect, test } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askWithClarifyUi, cancelClarifyInput, handleClarifyInput, isClarifyPending } from "./ui";

const context = { hasUI: true } as unknown as ExtensionContext;

afterEach(() => {
  cancelClarifyInput();
});

describe("clarify input parsing", () => {
  test("returns unavailable immediately without UI and ignores input without pending prompt", async () => {
    await expect(
      askWithClarifyUi({ type: "text", message: "Explain" }, {
        hasUI: false,
      } as unknown as ExtensionContext),
    ).resolves.toBeUndefined();
    expect(handleClarifyInput("anything")).toEqual({ handled: false, valid: false });
  });

  test("empty input cancels a pending prompt", async () => {
    const answerPromise = askWithClarifyUi({ type: "text", message: "Explain" }, context);

    expect(handleClarifyInput("   ")).toEqual({ handled: true, valid: true });
    await expect(answerPromise).resolves.toBeUndefined();
  });

  test("text input returns text answers", async () => {
    const answerPromise = askWithClarifyUi({ type: "text", message: "Explain" }, context);

    expect(handleClarifyInput("hello")).toEqual({ handled: true, valid: true });
    await expect(answerPromise).resolves.toEqual({ type: "text", value: "hello" });
  });

  test("confirm input accepts yes/no and rejects invalid replies", async () => {
    const invalidPromise = askWithClarifyUi({ type: "confirm", message: "Proceed?" }, context);
    expect(handleClarifyInput("maybe")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(invalidPromise).resolves.toBeUndefined();

    const yesPromise = askWithClarifyUi({ type: "confirm", message: "Proceed?" }, context);
    expect(handleClarifyInput("yes")).toEqual({ handled: true, valid: true });
    await expect(yesPromise).resolves.toEqual({ type: "confirm", value: true });

    const noPromise = askWithClarifyUi({ type: "confirm", message: "Proceed?" }, context);
    expect(handleClarifyInput("n")).toEqual({ handled: true, valid: true });
    await expect(noPromise).resolves.toEqual({ type: "confirm", value: false });
  });

  test("does not select disabled select options", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "select",
        message: "Choose one",
        options: [
          { value: "enabled", label: "Enabled" },
          { value: "disabled", label: "Disabled", disabled: true },
        ],
      },
      context,
    );

    expect(isClarifyPending()).toBe(true);
    expect(handleClarifyInput("2")).toEqual({ handled: true, valid: false });
    expect(isClarifyPending()).toBe(true);
    expect(handleClarifyInput("1")).toEqual({ handled: true, valid: true });

    await expect(answerPromise).resolves.toEqual({
      type: "select",
      value: "enabled",
      label: "Enabled",
    });
  });

  test("select without custom rejects non-numeric text", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "select",
        message: "Choose one",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
      context,
    );

    expect(handleClarifyInput("other option")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(answerPromise).resolves.toBeUndefined();
  });

  test("select with no options rejects numeric input", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "select",
        message: "Choose one",
      },
      context,
    );

    expect(handleClarifyInput("1")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(answerPromise).resolves.toBeUndefined();
  });

  test("unknown prompt types are rejected", async () => {
    const answerPromise = askWithClarifyUi(
      { type: "unknown", message: "Choose one" } as unknown as Parameters<
        typeof askWithClarifyUi
      >[0],
      context,
    );

    expect(handleClarifyInput("anything")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(answerPromise).resolves.toBeUndefined();
  });

  test("custom select answers require non-numeric text", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "select",
        message: "Choose one",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        allowCustom: true,
      },
      context,
    );

    expect(handleClarifyInput("3")).toEqual({ handled: true, valid: false });
    expect(handleClarifyInput("other option")).toEqual({ handled: true, valid: true });

    await expect(answerPromise).resolves.toEqual({ type: "custom", value: "other option" });
  });

  test("multiselect all excludes disabled options", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "multiselect",
        message: "Choose many",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true },
          { value: "c", label: "C" },
        ],
      },
      context,
    );

    expect(handleClarifyInput("all")).toEqual({ handled: true, valid: true });

    await expect(answerPromise).resolves.toEqual({
      type: "multiselect",
      values: [
        { value: "a", label: "A" },
        { value: "c", label: "C" },
      ],
    });
  });

  test("multiselect all rejects prompts with no enabled options", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "multiselect",
        message: "Choose many",
        options: [
          { value: "a", label: "A", disabled: true },
          { value: "b", label: "B", disabled: true },
        ],
      },
      context,
    );

    expect(handleClarifyInput("all")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(answerPromise).resolves.toBeUndefined();
  });

  test("multiselect without options rejects numeric input", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "multiselect",
        message: "Choose many",
      },
      context,
    );

    expect(handleClarifyInput("1")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(answerPromise).resolves.toBeUndefined();
  });

  test("multiselect rejects disabled-only input and deduplicates selected values", async () => {
    const disabledPromise = askWithClarifyUi(
      {
        type: "multiselect",
        message: "Choose many",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true },
        ],
      },
      context,
    );
    expect(handleClarifyInput("2")).toEqual({ handled: true, valid: false });
    cancelClarifyInput();
    await expect(disabledPromise).resolves.toBeUndefined();

    const duplicatePromise = askWithClarifyUi(
      {
        type: "multiselect",
        message: "Choose many",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
      context,
    );
    expect(handleClarifyInput("1, 1 2")).toEqual({ handled: true, valid: true });
    await expect(duplicatePromise).resolves.toEqual({
      type: "multiselect",
      values: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    });
  });

  test("cancel clears pending input", async () => {
    const answerPromise = askWithClarifyUi(
      {
        type: "text",
        message: "Explain",
      },
      context,
    );

    expect(isClarifyPending()).toBe(true);
    cancelClarifyInput();
    expect(isClarifyPending()).toBe(false);

    await expect(answerPromise).resolves.toBeUndefined();
  });
});
