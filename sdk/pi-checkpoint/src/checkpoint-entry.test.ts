import { describe, test, expect } from "vitest";
import {
  extractCheckpointData,
  getCheckpointEntries,
  hasLegacyFileState,
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
    beforeState: "abc123",
    afterState: "def456",
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

  test("rejects non-string beforeState", () => {
    expect(isCheckpointEntry({ ...valid, beforeState: 123 })).toBe(false);
  });

  test("rejects non-string afterState", () => {
    expect(isCheckpointEntry({ ...valid, afterState: 123 })).toBe(false);
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
      beforeState: "abc",
      afterState: "def",
      prompt: "p1",
      fileCount: 0,
      fileChanges: [],
      createdAt: new Date().toISOString(),
    };
    const result = filterCheckpointEntries([valid, "bad", { v: 1, kind: "checkpoint" }, null]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(valid);
  });

  test("normalizes alias-only checkpoint entries", () => {
    const result = filterCheckpointEntries([
      {
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
      },
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        beforeState: "abc",
        afterState: "def",
      }),
    );
  });

  test("drops alias checkpoint entries with non-array fileChanges", () => {
    expect(
      filterCheckpointEntries([
        {
          v: 2,
          kind: "checkpoint",
          turnId: "t1",
          userEntryId: "e1",
          beforeCommit: "abc",
          afterCommit: "def",
          prompt: "p1",
          fileCount: 0,
          fileChanges: "bad",
          createdAt: new Date().toISOString(),
        },
      ]),
    ).toEqual([]);
  });

  test("drops incomplete alias checkpoint entries", () => {
    expect(
      filterCheckpointEntries([
        {
          v: 2,
          kind: "checkpoint",
          turnId: "t1",
          userEntryId: "e1",
          beforeCommit: "abc",
          afterCommit: "def",
          prompt: "p1",
          fileCount: 0,
          fileChanges: [],
        },
      ]),
    ).toEqual([]);
  });

  test("normalizes legacy checkpoint entries and marks legacy file state", () => {
    const [entry] = filterCheckpointEntries([
      {
        entryId: "legacy-entry",
        commitHash: "abc",
        prompt: "legacy prompt",
        fileCount: 1,
        timestamp: 1_704_067_200_000,
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }, "bad"],
      },
    ]);

    expect(entry).toEqual(
      expect.objectContaining({
        v: 2,
        kind: "checkpoint",
        turnId: "legacy:legacy-entry",
        userEntryId: "legacy-entry",
        beforeState: "abc",
        afterState: "abc",
        fileChanges: [{ path: "a.ts", added: 1, removed: 0 }],
      }),
    );
    expect(entry ? hasLegacyFileState(entry) : false).toBe(true);
  });

  test("normalizes minimal legacy entries", () => {
    const [entry] = filterCheckpointEntries([{ entryId: "legacy-entry", commitHash: "abc" }]);

    expect(entry).toEqual(
      expect.objectContaining({
        prompt: "(legacy checkpoint)",
        fileCount: 0,
        fileChanges: [],
        createdAt: new Date(0).toISOString(),
      }),
    );
  });

  test("extracts checkpoint data from custom session entries", () => {
    const data = { kind: "checkpoint" };

    expect(
      extractCheckpointData([
        { type: "custom", customType: "pi-checkpoint", data },
        { type: "custom", customType: "other", data: {} },
        { type: "message", data: {} },
        null,
      ]),
    ).toEqual([data]);
  });

  test("gets checkpoint entries from raw session entries", () => {
    const valid: CheckpointEntry = {
      v: 2,
      kind: "checkpoint",
      turnId: "t1",
      userEntryId: "e1",
      beforeState: "abc",
      afterState: "def",
      prompt: "p1",
      fileCount: 0,
      fileChanges: [],
      createdAt: new Date().toISOString(),
    };

    expect(
      getCheckpointEntries([{ type: "custom", customType: "pi-checkpoint", data: valid }]),
    ).toEqual([valid]);
  });
});
