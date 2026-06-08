import { describe, expect, it } from "vitest";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

import { extractPrompt, findLastUserEntry } from "./prompt";

type UserMessageContent =
  | string
  | Array<
      | { readonly type: "text"; readonly text: string }
      | { readonly type: "image"; readonly data: string; readonly mimeType: string }
    >;

function createUserEntry(id: string, content: UserMessageContent): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content,
      timestamp: Date.now(),
    },
  };
}

function createAssistantEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
  };
}

describe("findLastUserEntry", () => {
  it("returns the latest user message in the branch", () => {
    const branch = [
      createUserEntry("user-1", "first"),
      createAssistantEntry("assistant-1"),
      createUserEntry("user-2", "second"),
    ];

    expect(findLastUserEntry(branch)?.id).toBe("user-2");
  });

  it("returns undefined when there is no user message", () => {
    expect(findLastUserEntry([createAssistantEntry("assistant-1")])).toBeUndefined();
  });
});

describe("extractPrompt", () => {
  it("returns string content as-is", () => {
    const leaf = createUserEntry("user-1", "hello world") as SessionMessageEntry;
    expect(extractPrompt(leaf)).toBe("hello world");
  });

  it("joins text blocks from array content and skips non-text blocks", () => {
    const leaf = createUserEntry("user-1", [
      { type: "text", text: "hello" },
      { type: "image", data: "base64-image", mimeType: "image/png" },
      { type: "text", text: "world" },
    ]) as SessionMessageEntry;

    expect(extractPrompt(leaf)).toBe("hello world");
  });

  it("falls back to [message] when content is missing", () => {
    const leaf = { message: { role: "user", timestamp: Date.now() } } as SessionMessageEntry;
    expect(extractPrompt(leaf)).toBe("[message]");
  });
});
