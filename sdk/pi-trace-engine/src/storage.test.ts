import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StorageManager,
  isReviewOutcome,
  isFailureLayer,
  isRecord,
  isSessionTrace,
  isPattern,
  parseFailureLayer,
} from "./storage";

const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockReaddir = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

beforeEach(() => {
  mockMkdir.mockReset().mockResolvedValue(undefined);
  mockReadFile.mockReset();
  mockWriteFile.mockReset().mockResolvedValue(undefined);
  mockReaddir.mockReset();
});

function makeTrace(sessionId: string, startTime = 1): unknown {
  return {
    sessionId,
    startTime,
    cwd: "/p",
    endTime: null,
    turns: [],
    summary: {
      totalToolCalls: 0,
      totalFilesRead: 0,
      totalFilesWritten: 0,
      totalCommandsRun: 0,
      failureCount: 0,
      errorLoopDetected: false,
      scopeCreepDetected: false,
      highRetryDetected: false,
      verificationHeuristic: false,
    },
  };
}

describe("StorageManager", () => {
  it("ensures directories", async () => {
    const storage = new StorageManager("/project");
    await storage.ensureDirs();
    expect(mockMkdir).toHaveBeenCalledTimes(4);
  });

  it("returns base directory under ~/.pi/agent/ayu/trace-lab", () => {
    const storage = new StorageManager("/project");
    const baseDir = storage.getBaseDir();
    expect(typeof baseDir).toBe("string");
    expect(baseDir.startsWith(path.join(os.homedir(), ".pi", "agent", "ayu", "trace-lab"))).toBe(
      true,
    );
  });

  it("uses unknown as the trace-lab base name for cwd without a basename", () => {
    const storage = new StorageManager(path.parse(process.cwd()).root);
    expect(path.basename(storage.getBaseDir()).startsWith("unknown-")).toBe(true);
  });

  it("saves and loads a valid session trace", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify(makeTrace("s1")));
    const storage = new StorageManager("/project");
    await storage.saveSessionTrace(makeTrace("s1") as never);
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const trace = await storage.loadSessionTrace("s1");
    expect(trace).not.toBeNull();
    expect(trace?.sessionId).toBe("s1");
  });

  it("returns null for invalid session trace JSON", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ notSession: true }));
    const storage = new StorageManager("/project");
    const trace = await storage.loadSessionTrace("s1");
    expect(trace).toBeNull();
  });

  it("returns null when session file is missing", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const trace = await storage.loadSessionTrace("s1");
    expect(trace).toBeNull();
  });

  it("lists only valid session traces", async () => {
    mockReaddir.mockResolvedValueOnce(["s1.json", "s2.json", "bad.json"]);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(makeTrace("s1", 1)))
      .mockResolvedValueOnce(JSON.stringify(makeTrace("s2", 2)))
      .mockResolvedValueOnce(JSON.stringify({ invalid: true }));

    const storage = new StorageManager("/project");
    const traces = await storage.listSessionTraces();
    expect(traces).toHaveLength(2);
    expect(traces[0]?.sessionId).toBe("s2");
  });

  it("filters session traces by date", async () => {
    mockReaddir.mockResolvedValueOnce(["old.json", "new.json"]);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(makeTrace("old", 1000)))
      .mockResolvedValueOnce(JSON.stringify(makeTrace("new", Date.now())));

    const storage = new StorageManager("/project");
    const traces = await storage.listSessionTraces(new Date(5000));
    expect(traces).toHaveLength(1);
    expect(traces[0]?.sessionId).toBe("new");
  });

  it("skips non-json files when listing traces", async () => {
    mockReaddir.mockResolvedValueOnce(["readme.md"]);
    const storage = new StorageManager("/project");
    const traces = await storage.listSessionTraces();
    expect(traces).toEqual([]);
  });

  it("handles readdir errors gracefully", async () => {
    mockReaddir.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const traces = await storage.listSessionTraces();
    expect(traces).toEqual([]);
  });

  it("handles read errors in listSessionTraces", async () => {
    mockReaddir.mockResolvedValueOnce(["s1.json"]);
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const traces = await storage.listSessionTraces();
    expect(traces).toEqual([]);
  });

  it("saves and loads a review", async () => {
    const content = `---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: null
should_iterate: false
---

## Outcome
success

## Failure Layer
N/A

## Harness Improvement
N/A

## Should Iterate
No

## Iteration Idea
N/A

## Reviewer Notes
notes
`;
    mockReadFile.mockResolvedValueOnce(content);
    const storage = new StorageManager("/project");
    await storage.saveReview({
      sessionId: "s1",
      reviewedAt: "2024-01-01T00:00:00.000Z",
      outcome: "success",
      failureLayer: null,
      harnessImprovement: null,
      shouldIterate: false,
      iterationIdea: null,
      reviewerNotes: "notes",
    });
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const review = await storage.loadReview("s1");
    expect(review).not.toBeNull();
    expect(review?.outcome).toBe("success");
  });

  it("returns null for missing review", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const review = await storage.loadReview("s1");
    expect(review).toBeNull();
  });

  it("loads all reviews", async () => {
    mockReaddir.mockResolvedValueOnce(["s1.md", "s2.md"]);
    mockReadFile.mockResolvedValueOnce(`---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: null
should_iterate: false
---

## Outcome
success

## Failure Layer
N/A

## Harness Improvement
N/A

## Should Iterate
No

## Iteration Idea
N/A

## Reviewer Notes
notes
`).mockResolvedValueOnce(`---
session_id: s2
reviewed_at: 2024-01-02T00:00:00.000Z
outcome: failure
failure_layer: observation
should_iterate: true
---

## Outcome
failure

## Failure Layer
observation

## Harness Improvement
improve

## Should Iterate
Yes

## Iteration Idea
idea

## Reviewer Notes
notes2
`);

    const storage = new StorageManager("/project");
    const reviews = await storage.loadAllReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews[0]?.outcome).toBe("success");
    expect(reviews[1]?.outcome).toBe("failure");
  });

  it("returns no reviews when the reviews directory cannot be read", async () => {
    mockReaddir.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const reviews = await storage.loadAllReviews();
    expect(reviews).toEqual([]);
  });

  it("handles corrupt review files gracefully", async () => {
    mockReaddir.mockResolvedValueOnce(["bad.md"]);
    mockReadFile.mockResolvedValueOnce("no frontmatter");
    const storage = new StorageManager("/project");
    const reviews = await storage.loadAllReviews();
    expect(reviews).toEqual([]);
  });

  it("saves and loads patterns", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify([
        { id: "p1", name: "Pattern 1" },
        { id: "p2", name: "Pattern 2" },
        { invalid: true },
      ]),
    );
    const storage = new StorageManager("/project");
    await storage.savePatterns([{ id: "p1", name: "Pattern 1" } as never]);
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const patterns = await storage.loadPatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.id).toBe("p1");
  });

  it("returns empty patterns when file is missing", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const patterns = await storage.loadPatterns();
    expect(patterns).toEqual([]);
  });

  it("returns empty patterns for non-array JSON", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ notArray: true }));
    const storage = new StorageManager("/project");
    const patterns = await storage.loadPatterns();
    expect(patterns).toEqual([]);
  });

  it("saves and loads iteration cards", async () => {
    mockReadFile.mockResolvedValueOnce("# Iteration Card");
    const storage = new StorageManager("/project");
    const path = await storage.saveIterationCard("p1", "# Iteration Card");
    expect(path).toContain("ITER-p1");
    expect(mockWriteFile).toHaveBeenCalledOnce();

    const content = await storage.loadIterationCard("p1");
    expect(content).toBe("# Iteration Card");
  });

  it("returns null for missing iteration card", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const content = await storage.loadIterationCard("p1");
    expect(content).toBeNull();
  });

  it("parses review with all failure layers", async () => {
    const layers = [
      "environment_contract",
      "procedural_skill",
      "action_realization",
      "trajectory_regulation",
      "observation",
    ];

    for (const layer of layers) {
      mockReadFile.mockResolvedValueOnce(`---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: partial
failure_layer: ${layer}
should_iterate: true
---

## Outcome
partial

## Failure Layer
${layer}

## Harness Improvement
imp

## Should Iterate
Yes

## Iteration Idea
idea

## Reviewer Notes
notes
`);
      const storage = new StorageManager("/project");
      const review = await storage.loadReview("s1");
      expect(review?.failureLayer).toBe(layer);
    }
  });

  it("parses review with invalid failure layer as null", async () => {
    mockReadFile.mockResolvedValueOnce(`---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: invalid_layer
should_iterate: false
---

## Outcome
success

## Failure Layer
invalid_layer

## Harness Improvement
N/A

## Should Iterate
No

## Iteration Idea
N/A

## Reviewer Notes
notes
`);
    const storage = new StorageManager("/project");
    const review = await storage.loadReview("s1");
    expect(review?.failureLayer).toBeNull();
  });

  it("parses review with null failure layer", async () => {
    mockReadFile.mockResolvedValueOnce(`---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: null
should_iterate: false
---

## Outcome
success

## Failure Layer
N/A

## Harness Improvement
N/A

## Should Iterate
No

## Iteration Idea
N/A

## Reviewer Notes
notes
`);
    const storage = new StorageManager("/project");
    const review = await storage.loadReview("s1");
    expect(review?.failureLayer).toBeNull();
  });

  it("parses review with missing frontmatter fields using defaults", async () => {
    mockReadFile.mockResolvedValueOnce(`---
session_id: s1
---

## Reviewer Notes
just body
`);
    const storage = new StorageManager("/project");
    const review = await storage.loadReview("s1");
    expect(review).not.toBeNull();
    expect(review?.outcome).toBe("success");
    expect(review?.shouldIterate).toBe(false);
    expect(review?.reviewerNotes).toBe("just body");
  });

  it("handles primitive JSON in loadSessionTrace", async () => {
    mockReadFile.mockResolvedValueOnce("123");
    const storage = new StorageManager("/project");
    const trace = await storage.loadSessionTrace("s1");
    expect(trace).toBeNull();
  });

  it("handles array with primitives in loadPatterns", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify([{ id: "p1", name: "Valid" }, 123, "str"]));
    const storage = new StorageManager("/project");
    const patterns = await storage.loadPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.id).toBe("p1");
  });

  it("skips non-md files in loadAllReviews", async () => {
    mockReaddir.mockResolvedValueOnce(["s1.md", "readme.txt"]);
    mockReadFile.mockResolvedValueOnce(`---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: null
should_iterate: false
---

## Reviewer Notes
notes
`);
    const storage = new StorageManager("/project");
    const reviews = await storage.loadAllReviews();
    expect(reviews).toHaveLength(1);
  });

  it("handles read errors in loadAllReviews", async () => {
    mockReaddir.mockResolvedValueOnce(["s1.md"]);
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const storage = new StorageManager("/project");
    const reviews = await storage.loadAllReviews();
    expect(reviews).toEqual([]);
  });

  it("parses review without session_id using fallback", async () => {
    mockReadFile.mockResolvedValueOnce(`---
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: null
should_iterate: false
---

## Outcome
success
`);
    const storage = new StorageManager("/project");
    const review = await storage.loadReview("fallback-id");
    expect(review?.sessionId).toBe("fallback-id");
  });

  it("parses review without reviewer notes using body fallback", async () => {
    mockReadFile.mockResolvedValueOnce(`---
session_id: s1
reviewed_at: 2024-01-01T00:00:00.000Z
outcome: success
failure_layer: null
should_iterate: false
---

## Outcome
success
`);
    const storage = new StorageManager("/project");
    const review = await storage.loadReview("s1");
    expect(review?.reviewerNotes).toBe("## Outcome\nsuccess");
  });
});

describe("type guards", () => {
  it("isReviewOutcome validates only known outcomes", () => {
    expect(isReviewOutcome("success")).toBe(true);
    expect(isReviewOutcome("partial")).toBe(true);
    expect(isReviewOutcome("failure")).toBe(true);
    expect(isReviewOutcome("unknown")).toBe(false);
    expect(isReviewOutcome(null)).toBe(false);
    expect(isReviewOutcome(123)).toBe(false);
  });

  it("isFailureLayer validates known layers and null", () => {
    expect(isFailureLayer(null)).toBe(true);
    expect(isFailureLayer("environment_contract")).toBe(true);
    expect(isFailureLayer("observation")).toBe(true);
    expect(isFailureLayer("unknown")).toBe(false);
    expect(isFailureLayer(123)).toBe(false);
    expect(isFailureLayer(undefined)).toBe(false);
  });

  it("isRecord checks plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("str")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it("isSessionTrace checks required fields", () => {
    expect(isSessionTrace({ sessionId: "s1", startTime: 1 })).toBe(true);
    expect(isSessionTrace({ sessionId: "s1" })).toBe(false);
    expect(isSessionTrace({ startTime: 1 })).toBe(false);
    expect(isSessionTrace(null)).toBe(false);
    expect(isSessionTrace("str")).toBe(false);
  });

  it("isPattern checks id and name", () => {
    expect(isPattern({ id: "p1", name: "Test" })).toBe(true);
    expect(isPattern({ id: "p1" })).toBe(false);
    expect(isPattern({ name: "Test" })).toBe(false);
    expect(isPattern(null)).toBe(false);
    expect(isPattern(123)).toBe(false);
  });

  it("parseFailureLayer handles all cases", () => {
    expect(parseFailureLayer(null)).toBeNull();
    expect(parseFailureLayer("null")).toBeNull();
    expect(parseFailureLayer("observation")).toBe("observation");
    expect(parseFailureLayer("unknown")).toBeNull();
    expect(parseFailureLayer("")).toBeNull();
  });

  it("renderReviewMarkdown uses Yes for shouldIterate true", async () => {
    const storage = new StorageManager("/project");
    await storage.saveReview({
      sessionId: "s1",
      reviewedAt: "2024-01-01T00:00:00.000Z",
      outcome: "success",
      failureLayer: null,
      harnessImprovement: null,
      shouldIterate: true,
      iterationIdea: null,
      reviewerNotes: "notes",
    });
    const written = mockWriteFile.mock.calls[0]?.[1];
    expect(written).toContain("should_iterate: true");
  });
});
