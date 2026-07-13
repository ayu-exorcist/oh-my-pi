import { describe, expect, test, vi } from "vitest";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import { AutoCheckpointProducer } from "./auto-checkpoint";

interface MockRepoOptions {
  readonly ensureReady?: (...args: unknown[]) => unknown;
  readonly checkpoint?: (...args: unknown[]) => unknown;
  readonly checkpointStaged?: (...args: unknown[]) => unknown;
  readonly checkpointIfChanged?: (...args: unknown[]) => unknown;
  readonly stageAll?: (...args: unknown[]) => unknown;
  readonly diffAgainst?: (...args: unknown[]) => unknown;
}

function createProducer(options: MockRepoOptions, initialCommit?: string) {
  return new AutoCheckpointProducer({
    repo: createMockRepo(options),
    exclude: ["node_modules/**"],
    createTurnId: () => "turn-1",
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    ...(initialCommit === undefined ? {} : { initialCommit }),
  });
}

describe("AutoCheckpointProducer", () => {
  test("returns a warning message when beforeCommit capture fails", async () => {
    const producer = createProducer({
      ensureReady: vi.fn().mockRejectedValue(new Error("git missing")),
    });

    const start = await producer.turnStart({ userEntryId: "entry-1", prompt: "test" });
    const end = await producer.turnEnd({ userEntryId: "entry-1", prompt: "test" });
    const final = await producer.finalizeRun();

    expect(start).toEqual({ ok: false, message: "Checkpoint failed: git missing" });
    expect(end).toEqual({ ok: false });
    expect(final).toEqual({ ok: false });
  });

  test("reuses beforeCommit when the agent run has no file changes", async () => {
    const checkpoint = vi.fn().mockResolvedValue("before-hash");
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint,
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
    });

    await producer.turnStart({ userEntryId: "entry-1", prompt: "no changes" });
    const end = await producer.turnEnd({ userEntryId: "entry-1", prompt: "no changes" });
    const final = await producer.finalizeRun();

    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(end).toEqual({ ok: true });
    expect(final).toEqual({
      ok: true,
      entry: expect.objectContaining({
        beforeCommit: "before-hash",
        afterCommit: "before-hash",
        fileCount: 0,
        fileChanges: [],
      }),
    });
  });

  test("reuses an unchanged active-branch commit without creating a start checkpoint", async () => {
    const checkpoint = vi.fn();
    const checkpointIfChanged = vi.fn().mockResolvedValue("active-branch-hash");
    const producer = createProducer(
      {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        checkpoint,
        checkpointIfChanged,
        stageAll: vi.fn().mockResolvedValue(undefined),
        diffAgainst: vi.fn().mockResolvedValue(""),
      },
      "active-branch-hash",
    );

    await producer.turnStart({ userEntryId: "entry-2", prompt: "no changes" });
    const final = await producer.finalizeRun();

    expect(checkpointIfChanged).toHaveBeenCalledWith("entry-2", "active-branch-hash");
    expect(checkpoint).not.toHaveBeenCalled();
    expect(final).toEqual({
      ok: true,
      entry: expect.objectContaining({
        beforeCommit: "active-branch-hash",
        afterCommit: "active-branch-hash",
        fileCount: 0,
      }),
    });
  });

  test("captures user changes made after the active-branch commit before the agent starts", async () => {
    const checkpointIfChanged = vi.fn().mockResolvedValue("pre-turn-hash");
    const producer = createProducer(
      {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        checkpointIfChanged,
        stageAll: vi.fn().mockResolvedValue(undefined),
        diffAgainst: vi.fn().mockResolvedValue(""),
      },
      "active-branch-hash",
    );

    await producer.turnStart({ userEntryId: "entry-2", prompt: "preserve manual change" });
    const final = await producer.finalizeRun();

    expect(checkpointIfChanged).toHaveBeenCalledWith("entry-2", "active-branch-hash");
    expect(final).toEqual({
      ok: true,
      entry: expect.objectContaining({
        beforeCommit: "pre-turn-hash",
        afterCommit: "pre-turn-hash",
      }),
    });
  });

  test("captures a CheckpointEntry around an agent run with File Change Stats", async () => {
    const ensureReady = vi.fn().mockResolvedValue(undefined);
    const checkpoint = vi.fn().mockResolvedValue("before-hash");
    const checkpointStaged = vi.fn().mockResolvedValue("after-hash");
    const stageAll = vi.fn().mockResolvedValue(undefined);
    const diffAgainst = vi.fn().mockResolvedValue("2\t1\tsrc/app.ts\n");
    const producer = createProducer({
      ensureReady,
      checkpoint,
      checkpointStaged,
      stageAll,
      diffAgainst,
    });

    const start = await producer.turnStart({
      userEntryId: "entry-1",
      prompt: "refactor checkpoint handling",
    });
    const end = await producer.turnEnd({
      userEntryId: "entry-1",
      prompt: "refactor checkpoint handling",
    });
    const final = await producer.finalizeRun();

    expect(start).toEqual({ ok: true, entries: [] });
    expect(end).toEqual({ ok: true });
    expect(ensureReady).toHaveBeenCalledWith(["node_modules/**"]);
    expect(checkpoint).toHaveBeenCalledWith("entry-1");
    expect(checkpointStaged).toHaveBeenCalledWith("entry-1");
    expect(stageAll).toHaveBeenCalledTimes(1);
    expect(diffAgainst).toHaveBeenCalledWith("before-hash");
    expect(final).toEqual({
      ok: true,
      entry: {
        v: 2,
        kind: "checkpoint",
        turnId: "turn-1",
        userEntryId: "entry-1",
        beforeCommit: "before-hash",
        afterCommit: "after-hash",
        prompt: "refactor checkpoint handling",
        fileCount: 1,
        fileChanges: [{ path: "src/app.ts", added: 2, removed: 1 }],
        createdAt: "2026-01-02T03:04:05.000Z",
      },
    });
  });

  test("finalizeRun preserves the pending user decision label", async () => {
    const checkpoint = vi
      .fn()
      .mockResolvedValueOnce("before-hash")
      .mockResolvedValueOnce("after-hash");
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint,
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue("1\t0\tsrc/app.ts\n"),
    });

    await producer.turnStart({ userEntryId: "entry-1", prompt: "initial" });
    const end = await producer.turnEnd({ userEntryId: "entry-2", prompt: "follow-up" });
    const final = await producer.finalizeRun();

    expect(end).toEqual({ ok: true });
    expect(checkpoint).toHaveBeenCalledWith("entry-1");
    expect(final).toEqual({
      ok: true,
      entry: expect.objectContaining({ userEntryId: "entry-1", prompt: "initial" }),
    });
  });

  test("turnStart finalizes the previous user decision before opening the next one", async () => {
    const checkpoint = vi
      .fn()
      .mockResolvedValueOnce("before-1")
      .mockResolvedValueOnce("after-1")
      .mockResolvedValueOnce("before-2")
      .mockResolvedValueOnce("after-2");
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint,
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue("1\t0\tsrc/app.ts\n"),
    });

    const first = await producer.turnStart({ userEntryId: "entry-1", prompt: "initial" });
    const second = await producer.turnStart({ userEntryId: "entry-2", prompt: "follow-up" });
    await producer.turnEnd({ userEntryId: "entry-2", prompt: "follow-up" });
    const final = await producer.finalizeRun();

    expect(first).toEqual({ ok: true, entries: [] });
    expect(second).toEqual({
      ok: true,
      entries: [expect.objectContaining({ userEntryId: "entry-1", prompt: "initial" })],
    });
    expect(final).toEqual({
      ok: true,
      entry: expect.objectContaining({ userEntryId: "entry-2", prompt: "follow-up" }),
    });
    expect(checkpoint).toHaveBeenCalledTimes(4);
    expect(checkpoint).toHaveBeenNthCalledWith(1, "entry-1");
    expect(checkpoint).toHaveBeenNthCalledWith(2, "entry-1");
    expect(checkpoint).toHaveBeenNthCalledWith(3, "entry-2");
    expect(checkpoint).toHaveBeenNthCalledWith(4, "entry-2");
  });

  test("finalizeRun reports a warning message when final capture fails", async () => {
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint: vi.fn().mockResolvedValueOnce("before-1"),
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockRejectedValueOnce(new Error("diff failed")),
    });

    await producer.turnStart({ userEntryId: "entry-1", prompt: "initial" });
    const final = await producer.finalizeRun();

    expect(final).toEqual({
      ok: false,
      message: "Checkpoint finalization failed: diff failed",
    });
  });

  test("turnStart drops a failed previous finalize before opening the next turn", async () => {
    const checkpoint = vi.fn().mockResolvedValueOnce("before-1").mockResolvedValueOnce("before-2");
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint,
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockRejectedValueOnce(new Error("diff failed")),
    });

    await producer.turnStart({ userEntryId: "entry-1", prompt: "initial" });
    const second = await producer.turnStart({ userEntryId: "entry-2", prompt: "follow-up" });

    expect(second).toEqual({ ok: true, entries: [] });
    expect(checkpoint).toHaveBeenNthCalledWith(1, "entry-1");
    expect(checkpoint).toHaveBeenNthCalledWith(2, "entry-2");
  });

  test("defers agent_end finalization after an assistant error until the retry settles", async () => {
    const checkpoint = vi
      .fn()
      .mockResolvedValueOnce("before-hash")
      .mockResolvedValueOnce("after-hash");
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint,
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
    });

    await producer.turnStart({ userEntryId: "entry-1", prompt: "retry me" });
    producer.recordAssistantStopReason("error");
    expect(producer.shouldFinalizeOnAgentEnd()).toBe(false);

    await producer.turnStart({ userEntryId: "entry-1", prompt: "retry me" });
    producer.recordAssistantStopReason("stop");
    expect(producer.shouldFinalizeOnAgentEnd()).toBe(true);

    const final = await producer.finalizeRun();
    expect(final).toEqual({
      ok: true,
      entry: expect.objectContaining({ userEntryId: "entry-1", prompt: "retry me" }),
    });
  });
});
