import { describe, expect, test } from "vitest";

import {
  parseLocalTagList,
  parseRemoteTagList,
  selectReleaseTagsToPush,
} from "./select-release-tags";

describe("release tag helpers", () => {
  test("parses local tag output", () => {
    expect(parseLocalTagList("a\n b \n\n")).toEqual(["a", "b"]);
  });

  test("parses remote tag output", () => {
    expect(
      parseRemoteTagList(
        "c48c415f refs/tags/@ayulab/oh-my-pi@0.4.2\n644e905f refs/tags/@ayulab/pi-checkpoint@0.5.0\n",
      ),
    ).toEqual(["@ayulab/oh-my-pi@0.4.2", "@ayulab/pi-checkpoint@0.5.0"]);
  });

  test("skips malformed remote lines, deduplicates local tags, and filters remote tags", () => {
    expect(parseRemoteTagList("missing-ref\n1234 refs/heads/main\n")).toEqual([]);
    expect(
      selectReleaseTagsToPush(
        ["@ayulab/oh-my-pi@0.4.2", "@ayulab/oh-my-pi@0.4.2", "@ayulab/pi-checkpoint@0.5.0"],
        ["@ayulab/pi-checkpoint@0.5.0"],
      ),
    ).toEqual(["@ayulab/oh-my-pi@0.4.2"]);
  });
});
