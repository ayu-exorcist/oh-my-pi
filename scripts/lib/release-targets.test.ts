import { describe, expect, test } from "vitest";

import { parseReleaseTargets } from "./release-targets";

function flags(
  entries: ReadonlyArray<readonly [string, string | true]>,
): Map<string, string | true> {
  return new Map(entries);
}

describe("release target parsing", () => {
  test("defaults to publishing all when no target is provided", () => {
    expect(parseReleaseTargets(flags([]), [])).toEqual({
      targets: [],
      packageFlagProvided: false,
      publishAll: true,
    });
  });

  test("parses comma-separated package flag targets", () => {
    expect(parseReleaseTargets(flags([["package", "a,b, c"]]), [])).toEqual({
      targets: ["a", "b", "c"],
      packageFlagProvided: true,
      publishAll: false,
    });
  });

  test("parses package flag value plus following positional targets", () => {
    expect(parseReleaseTargets(flags([["package", "a"]]), ["b", "c"])).toEqual({
      targets: ["a", "b", "c"],
      packageFlagProvided: true,
      publishAll: false,
    });
  });

  test("parses bare positional targets", () => {
    expect(parseReleaseTargets(flags([]), ["a", "b"])).toEqual({
      targets: ["a", "b"],
      packageFlagProvided: false,
      publishAll: false,
    });
  });

  test("lets explicit package targets override --all", () => {
    expect(
      parseReleaseTargets(
        flags([
          ["all", true],
          ["package", "a"],
        ]),
        [],
      ),
    ).toEqual({
      targets: ["a"],
      packageFlagProvided: true,
      publishAll: false,
    });
  });
});
