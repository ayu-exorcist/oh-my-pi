import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@ayulab/runtime-core";
import { isUserMessageEntry } from "./tree-entry";

/** Narrow `unknown` to a Pi text content block. */
function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

/** Narrow `SessionEntry` to a user message entry. */
function isSessionUserMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return isUserMessageEntry(entry);
}

/** Find the most recent user message in a branch (used to label checkpoints). */
export function findLastUserEntry(branch: SessionEntry[]): SessionMessageEntry | undefined {
  return [...branch].reverse().find(isSessionUserMessageEntry);
}

/**
 * Extract the plain-text prompt from a user message entry.
 *
 * Handles both string content and array-of-blocks formats.
 * Falls back to `"[message]"` for malformed entries.
 */
export function extractPrompt(leaf: SessionMessageEntry): string {
  const msg = leaf.message;
  // istanbul ignore next — unreachable for type-safe callers
  if (!("content" in msg)) return "[message]";

  const content = msg.content;
  if (typeof content === "string") return content;
  // istanbul ignore next — TypeScript guarantees content is string | array
  if (Array.isArray(content)) {
    return content
      .filter(isTextContent)
      .map((c) => c.text)
      .join(" ");
  }
  // istanbul ignore next — unreachable for type-safe callers, kept for runtime safety
  return "[message]";
}
