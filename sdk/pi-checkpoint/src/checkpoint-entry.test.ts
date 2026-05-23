import { describe, test, expect } from "vitest";
import {
  isCheckpointEntry,
  filterCheckpointEntries,
  type CheckpointEntry,
} from "./checkpoint-entry";

describe("isCheckpointEntry", () => {
  const valid: CheckpointEntry = {
    v: 2,
    kind: "checkpoint",
    turnId: "t1",
    userEntryId: "e1",
    beforeCommit: "abc123",
    afterCommit: "def456",
    prompt: "hello",
    fileCount: 2,
    fileChanges: [
      { path: "a.ts", added: 1, removed: 0 },
      { path: "b.ts", added: 0, removed: 2 },
    ],
    createdAt: new Date().toISOString(),
  };

  test("accepts valid checkpoint entry", () => {
    expect(isCheckpointEntry(valid)).toBe(true);
  });

  test("rejects non-object", () => {
    expect(isCheckpointEntry("string")).toBe(false);
    expect(isCheckpointEntry(42)).toBe(false);
    expect(isCheckpointEntry(null)).toBe(false);
    expect(isCheckpointEntry(undefined)).toBe(false);
  });

  test("rejects wrong v", () => {
    expect(isCheckpointEntry({ ...valid, v: 1 })).toBe(false);
  });

  test("rejects wrong kind", () => {
    expect(isCheckpointEntry({ ...valid, kind: "other" })).toBe(false);
  });

  test("rejects missing turnId", () => {
    const { turnId: _, ...rest } = valid;
    expect(isCheckpointEntry(rest)).toBe(false);
  });

  test("rejects non-string turnId", () => {
    expect(isCheckpointEntry({ ...valid, turnId: 123 })).toBe(false);
  });

  test("rejects non-string userEntryId", () => {
    expect(isCheckpointEntry({ ...valid, userEntryId: 123 })).toBe(false);
  });

  test("rejects non-string beforeCommit", () => {
    expect(isCheckpointEntry({ ...valid, beforeCommit: 123 })).toBe(false);
  });

  test("rejects non-string afterCommit", () => {
    expect(isCheckpointEntry({ ...valid, afterCommit: 123 })).toBe(false);
  });

  test("rejects non-string prompt", () => {
    expect(isCheckpointEntry({ ...valid, prompt: 123 })).toBe(false);
  });

  test("rejects non-array fileChanges", () => {
    expect(isCheckpointEntry({ ...valid, fileChanges: "changes" })).toBe(false);
  });

  test("rejects invalid file change path", () => {
    const bad = {
      ...valid,
      fileChanges: [{ path: 123, added: 1, removed: 0 }],
    };
    expect(isCheckpointEntry(bad)).toBe(false);
  });

  test("rejects invalid file change added", () => {
    const bad = {
      ...valid,
      fileChanges: [{ path: "a.ts", added: "1", removed: 0 }],
    };
    expect(isCheckpointEntry(bad)).toBe(false);
  });

  test("rejects invalid file change removed", () => {
    const bad = {
      ...valid,
      fileChanges: [{ path: "a.ts", added: 1, removed: "0" }],
    };
    expect(isCheckpointEntry(bad)).toBe(false);
  });

  test("rejects non-string createdAt", () => {
    expect(isCheckpointEntry({ ...valid, createdAt: 123 })).toBe(false);
  });

  test("accepts empty fileChanges", () => {
    expect(isCheckpointEntry({ ...valid, fileChanges: [] })).toBe(true);
  });

  test("rejects non-object file change", () => {
    const bad = { ...valid, fileChanges: ["not-an-object"] };
    expect(isCheckpointEntry(bad)).toBe(false);
  });
});

describe("filterCheckpointEntries", () => {
  test("filters valid entries and discards invalid ones", () => {
    const valid: CheckpointEntry = {
      v: 2,
      kind: "checkpoint",
      turnId: "t1",
      userEntryId: "e1",
      beforeCommit: "abc",
      afterCommit: "def",
      prompt: "p1",
      fileCount: 0,
      fileChanges: [],
      createdAt: new Date().toISOString(),
    };
    const result = filterCheckpointEntries([valid, "bad", { v: 1, kind: "checkpoint" }, null]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(valid);
  });

  test("returns empty array for empty input", () => {
    expect(filterCheckpointEntries([])).toEqual([]);
  });

  test("returns empty array when all invalid", () => {
    expect(filterCheckpointEntries(["bad", 123, null])).toEqual([]);
  });
});
