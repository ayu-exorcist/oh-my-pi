import { describe, expect, test } from "vitest";

import { buildReleasePreviewRows, applyAutoBumpPlanToPackages } from "./release-preview";
import type { PackageInfo } from "./types";

function pkg(name: string, version: string): PackageInfo {
  return {
    name,
    version,
    path: `/repo/${name}`,
    pkg: { name, version },
    isRoot: false,
  };
}

describe("release preview", () => {
  test("applies planned versions to cloned packages only", () => {
    const packages = [pkg("a", "1.0.0"), pkg("b", "1.0.0")];

    const preview = applyAutoBumpPlanToPackages(packages, [
      { name: "a", fromVersion: "1.0.0", toVersion: "1.0.1" },
    ]);

    expect(preview[0]?.version).toBe("1.0.1");
    expect(preview[0]?.pkg.version).toBe("1.0.1");
    expect(preview[1]?.version).toBe("1.0.0");
    expect(packages[0]?.version).toBe("1.0.0");
  });

  test("builds combined preview rows in package order", () => {
    const allPackages = [pkg("a", "1.0.1"), pkg("b", "2.0.0"), pkg("c", "3.0.0")];
    const publishPackages = [allPackages[0]!, allPackages[2]!];

    const rows = buildReleasePreviewRows(allPackages, publishPackages, [
      { name: "a", fromVersion: "1.0.0", toVersion: "1.0.1" },
    ]);

    expect(rows).toEqual([
      {
        name: "a",
        currentVersion: "1.0.0",
        nextVersion: "1.0.1",
        bump: true,
        publish: true,
        status: "will bump",
      },
      {
        name: "b",
        currentVersion: "2.0.0",
        nextVersion: "—",
        bump: false,
        publish: false,
        status: "skip",
      },
      {
        name: "c",
        currentVersion: "3.0.0",
        nextVersion: "3.0.0",
        bump: false,
        publish: true,
        status: "will publish",
      },
    ]);
  });

  test("marks packages as skip when they are neither bumped nor published", () => {
    const rows = buildReleasePreviewRows([pkg("solo", "1.0.0")], [], []);
    expect(rows).toEqual([
      {
        name: "solo",
        currentVersion: "1.0.0",
        nextVersion: "—",
        bump: false,
        publish: false,
        status: "skip",
      },
    ]);
  });
});
