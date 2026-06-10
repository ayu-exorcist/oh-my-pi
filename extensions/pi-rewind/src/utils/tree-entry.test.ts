import { describe, expect, test } from "vitest";

import { getTreeEventRecord, isEntryWithId, toTreeEntryRecords } from "./tree-entry";

describe("tree entry guards", () => {
  test("accepts entries with string, null, or missing parent ids", () => {
    expect(isEntryWithId({ id: "root" })).toBe(true);
    expect(isEntryWithId({ id: "child", parentId: "root" })).toBe(true);
    expect(isEntryWithId({ id: "root", parentId: null })).toBe(true);
  });

  test("rejects entries with invalid ids or parent ids", () => {
    expect(isEntryWithId({ id: 1 })).toBe(false);
    expect(isEntryWithId({ id: "child", parentId: 1 })).toBe(false);
    expect(isEntryWithId(null)).toBe(false);
  });

  test("filters tree entries with valid parent ids only", () => {
    expect(
      toTreeEntryRecords([
        { id: "valid", parentId: null },
        { id: "invalid", parentId: 1 },
      ]).map((entry) => entry.id),
    ).toEqual(["valid"]);
  });

  test("reads tree event ids from direct and preparation targets", () => {
    expect(
      getTreeEventRecord({
        oldLeafId: "old",
        targetId: "target",
        newLeafId: "new",
      }),
    ).toEqual({
      oldLeafId: "old",
      targetId: "target",
      newLeafId: "new",
      preparation: undefined,
    });

    expect(getTreeEventRecord({ preparation: { targetId: "prepared" } })?.targetId).toBe(
      "prepared",
    );
  });
});
