import { describe, expect, it } from "vitest";

import { findLatestBranchCheckpoint, getBranchCheckpointEntries } from "./branch-checkpoints";

function createUserEntry(id: string): unknown {
  return {
    type: "message",
    id,
    message: { role: "user" },
  };
}

function createAssistantEntry(id: string): unknown {
  return {
    type: "message",
    id,
    message: { role: "assistant" },
  };
}

function createCheckpoint(userEntryId: string, afterState: string): unknown {
  return {
    v: 2,
    kind: "checkpoint",
    turnId: `${userEntryId}-turn`,
    userEntryId,
    beforeState: `${afterState}-before`,
    afterState,
    prompt: userEntryId,
    fileCount: 0,
    fileChanges: [],
    createdAt: "2026-01-02T03:04:05.000Z",
  };
}

function wrapCheckpoint(data: unknown): unknown {
  return {
    type: "custom",
    customType: "pi-checkpoint",
    data,
  };
}

describe("getBranchCheckpointEntries", () => {
  it("returns only checkpoints for user entries present in the branch", () => {
    const entries = [
      wrapCheckpoint(createCheckpoint("user-1", "commit-1")),
      wrapCheckpoint(createCheckpoint("user-2", "commit-2")),
    ];
    const branch = [createUserEntry("user-1"), createAssistantEntry("assistant-1")];

    expect(getBranchCheckpointEntries(entries, branch).map((entry) => entry.userEntryId)).toEqual([
      "user-1",
    ]);
  });

  it("deduplicates checkpoint entries by user entry and keeps the latest checkpoint data", () => {
    const entries = [
      wrapCheckpoint(createCheckpoint("user-1", "old-commit")),
      wrapCheckpoint(createCheckpoint("user-1", "new-commit")),
    ];
    const branch = [createUserEntry("user-1")];

    const checkpoints = getBranchCheckpointEntries(entries, branch);

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.afterState).toBe("new-commit");
  });

  it("returns checkpoints in branch user-entry order", () => {
    const entries = [
      wrapCheckpoint(createCheckpoint("user-2", "commit-2")),
      wrapCheckpoint(createCheckpoint("user-1", "commit-1")),
    ];
    const branch = [createUserEntry("user-1"), createUserEntry("user-2")];

    expect(getBranchCheckpointEntries(entries, branch).map((entry) => entry.userEntryId)).toEqual([
      "user-1",
      "user-2",
    ]);
  });

  it("returns an empty array when no user entries are on the branch", () => {
    const entries = [wrapCheckpoint(createCheckpoint("user-1", "commit-1"))];
    expect(getBranchCheckpointEntries(entries, [createAssistantEntry("assistant-1")])).toEqual([]);
  });

  it("ignores branch entries without user message shape", () => {
    const entries = [wrapCheckpoint(createCheckpoint("user-1", "commit-1"))];
    const branch = [
      { id: "metadata-1", type: "custom", customType: "note", data: {} },
      { id: "message-without-record", type: "message", message: "user" },
    ];

    expect(getBranchCheckpointEntries(entries, branch)).toEqual([]);
  });
});

describe("findLatestBranchCheckpoint", () => {
  it("returns the latest matching checkpoint", () => {
    const entries = [
      wrapCheckpoint(createCheckpoint("user-1", "commit-1")),
      wrapCheckpoint(createCheckpoint("user-2", "commit-2")),
    ];
    const branch = [createUserEntry("user-1"), createUserEntry("user-2")];

    expect(findLatestBranchCheckpoint(entries, branch)?.afterState).toBe("commit-2");
  });

  it("returns undefined when branch has no matching checkpoints", () => {
    expect(
      findLatestBranchCheckpoint([wrapCheckpoint(createCheckpoint("user-1", "commit-1"))], []),
    ).toBeUndefined();
  });

  it("returns undefined when no checkpoint entries are present", () => {
    expect(findLatestBranchCheckpoint([], [createUserEntry("user-1")])).toBeUndefined();
  });
});
