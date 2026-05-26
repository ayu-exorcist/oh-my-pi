import { describe, expect, test, vi } from "vitest";
import { createMockRepo } from "@ayulab/pi-checkpoint/testing";
import { AutoCheckpointProducer } from "./auto-checkpoint";

interface MockRepoOptions {
  readonly ensureReady?: (...args: unknown[]) => unknown;
  readonly checkpoint?: (...args: unknown[]) => unknown;
  readonly stageAll?: (...args: unknown[]) => unknown;
  readonly diffAgainst?: (...args: unknown[]) => unknown;
}

function createProducer(options: MockRepoOptions) {
  return new AutoCheckpointProducer({
    repo: createMockRepo(options),
    exclude: ["node_modules/**"],
    createTurnId: () => "turn-1",
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
}

describe("AutoCheckpointProducer", () => {
  test("returns a warning message when beforeCommit capture fails", async () => {
    const producer = createProducer({
      ensureReady: vi.fn().mockRejectedValue(new Error("git missing")),
    });

    const start = await producer.turnStart({ userEntryId: "entry-1", prompt: "test" });
    const end = await producer.turnEnd();

    expect(start).toEqual({ ok: false, message: "Checkpoint failed: git missing" });
    expect(end).toEqual({ ok: false });
  });

  test("reuses beforeCommit when the Turn has no file changes", async () => {
    const checkpoint = vi.fn().mockResolvedValue("before-hash");
    const producer = createProducer({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      checkpoint,
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
    });

    await producer.turnStart({ userEntryId: "entry-1", prompt: "no changes" });
    const end = await producer.turnEnd();

    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(end).toEqual({
      ok: true,
      entry: expect.objectContaining({
        beforeCommit: "before-hash",
        afterCommit: "before-hash",
        fileCount: 0,
        fileChanges: [],
      }),
    });
  });

  test("captures a CheckpointEntry around a Turn with File Change Stats", async () => {
    const ensureReady = vi.fn().mockResolvedValue(undefined);
    const checkpoint = vi
      .fn()
      .mockResolvedValueOnce("before-hash")
      .mockResolvedValueOnce("after-hash");
    const stageAll = vi.fn().mockResolvedValue(undefined);
    const diffAgainst = vi.fn().mockResolvedValue("2\t1\tsrc/app.ts\n");
    const producer = createProducer({ ensureReady, checkpoint, stageAll, diffAgainst });

    const start = await producer.turnStart({
      userEntryId: "entry-1",
      prompt: "refactor checkpoint handling",
    });
    const end = await producer.turnEnd();

    expect(start).toEqual({ ok: true });
    expect(ensureReady).toHaveBeenCalledWith(["node_modules/**"]);
    expect(checkpoint).toHaveBeenCalledWith("entry-1");
    expect(stageAll).toHaveBeenCalled();
    expect(diffAgainst).toHaveBeenCalledWith("before-hash");
    expect(end).toEqual({
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
});
