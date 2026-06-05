import { describe, expect, test } from "vitest";

import { planAutoBumps } from "./auto-bump";
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

describe("auto bump plan", () => {
  test("bumps only published packages with changed inputs", () => {
    const packages = [pkg("a", "1.0.0"), pkg("b", "1.0.0")];

    const plan = planAutoBumps(packages, {
      getRegistryVersion: (name) => (name === "a" || name === "b" ? "1.0.0" : null),
      hasPublishedTag: (current) => current.name !== "b",
      hasChangedInputs: (current) => current.name === "a",
    });

    expect(plan).toEqual([
      {
        name: "a",
        fromVersion: "1.0.0",
        toVersion: "1.0.1",
      },
    ]);
  });

  test("skips packages that are not yet published", () => {
    const packages = [pkg("a", "1.0.0")];

    const plan = planAutoBumps(packages, {
      getRegistryVersion: () => null,
      hasPublishedTag: () => true,
      hasChangedInputs: () => true,
    });

    expect(plan).toEqual([]);
  });

  test("does not bump when all versions are already unpublished or unchanged", () => {
    const packages = [pkg("a", "1.0.0")];

    const plan = planAutoBumps(packages, {
      getRegistryVersion: () => "0.9.0",
      hasPublishedTag: () => true,
      hasChangedInputs: () => true,
    });

    expect(plan).toEqual([]);
  });
});
