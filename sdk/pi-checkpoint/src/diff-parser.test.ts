import { describe, test, expect } from "vitest";
import { parseDiffStats } from "./diff-parser";

describe("parseDiffStats", () => {
  test("parses standard numstat output", () => {
    const input = "2\t1\tdata.txt\n";
    const result = parseDiffStats(input);
    expect(result).toEqual([{ path: "data.txt", added: 2, removed: 1 }]);
  });

  test("parses binary file output", () => {
    const input = "-\t-\tbin.png\n";
    const result = parseDiffStats(input);
    expect(result).toEqual([{ path: "bin.png", added: 0, removed: 0 }]);
  });

  test("parses multiple files", () => {
    const input = "5\t2\ta.ts\n3\t0\tb.ts\n";
    const result = parseDiffStats(input);
    expect(result).toEqual([
      { path: "a.ts", added: 5, removed: 2 },
      { path: "b.ts", added: 3, removed: 0 },
    ]);
  });

  test("falls back for non-standard lines", () => {
    const input = "no-tabs-line\n";
    const result = parseDiffStats(input);
    expect(result).toEqual([{ path: "no-tabs-line", added: 0, removed: 0 }]);
  });

  test("handles empty output", () => {
    const result = parseDiffStats("");
    expect(result).toEqual([]);
  });
});
