import { describe, expect, test } from "vitest";
import { collectDependencies, createReleasePlan } from "./release-plan";
import type { PackageInfo } from "./types";

function pkg(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
): PackageInfo {
  return {
    name,
    version,
    path: `/repo/${name}`,
    pkg: { name, version, dependencies },
    isRoot: name === "root",
  };
}

function registry(versions: Record<string, string | null>): (name: string) => string | null {
  return (name) => versions[name] ?? null;
}

describe("Release Plan", () => {
  test("publishAll includes version drift in topological order", () => {
    const packages = [
      pkg("root", "1.0.0", { ext: "workspace:*" }),
      pkg("ext", "1.0.0", { sdk: "workspace:*" }),
      pkg("sdk", "1.0.0"),
    ];

    const result = createReleasePlan({
      packages,
      targets: [],
      publishAll: true,
      getRegistryVersion: registry({ root: "0.9.0", ext: "1.0.0", sdk: "0.9.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages: [packages[2], packages[0]],
        registryVersions: new Map([
          ["root", "0.9.0"],
          ["sdk", "0.9.0"],
        ]),
      },
    });
  });

  test("explicit target narrows to dependency closure and keeps drifting target", () => {
    const packages = [
      pkg("root", "1.0.0", { ext: "workspace:*" }),
      pkg("ext", "1.0.0", { sdk: "workspace:*" }),
      pkg("sdk", "1.0.0"),
    ];

    const result = createReleasePlan({
      packages,
      targets: ["ext"],
      publishAll: false,
      getRegistryVersion: registry({ root: "0.9.0", ext: "0.9.0", sdk: "1.0.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages: [packages[1]],
        registryVersions: new Map([["ext", "0.9.0"]]),
      },
    });
  });

  test("explicit target narrows to dependency closure and excludes current dependencies", () => {
    const packages = [
      pkg("root", "1.0.0", { ext: "workspace:*" }),
      pkg("ext", "1.0.0", { sdk: "workspace:*" }),
      pkg("sdk", "1.0.0"),
    ];

    const result = createReleasePlan({
      packages,
      targets: ["ext"],
      publishAll: false,
      getRegistryVersion: registry({ root: "0.9.0", ext: "1.0.0", sdk: "1.0.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages: [],
        registryVersions: new Map(),
      },
    });
  });

  test("explicit target handles cyclic dependency closure", () => {
    const packages = [
      pkg("a", "1.0.0", { b: "workspace:*" }),
      pkg("b", "1.0.0", { a: "workspace:*" }),
    ];

    const result = createReleasePlan({
      packages,
      targets: ["a"],
      publishAll: false,
      getRegistryVersion: registry({ a: "0.9.0", b: "0.9.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages: [],
        registryVersions: new Map([
          ["a", "0.9.0"],
          ["b", "0.9.0"],
        ]),
      },
    });
  });

  test("empty package list creates an empty Release Plan", () => {
    const result = createReleasePlan({
      packages: [],
      targets: [],
      publishAll: true,
      getRegistryVersion: registry({}),
    });

    expect(result).toEqual({
      ok: true,
      plan: { packages: [], registryVersions: new Map() },
    });
  });

  test("unknown explicit target returns an error", () => {
    const result = createReleasePlan({
      packages: [pkg("sdk", "1.0.0")],
      targets: ["missing"],
      publishAll: false,
      getRegistryVersion: registry({ sdk: "1.0.0" }),
    });

    expect(result).toEqual({ ok: false, reason: "unknown-target", target: "missing" });
  });

  test("ignores dependencies outside the workspace", () => {
    const packages = [pkg("sdk", "1.0.0", { external: "^1.0.0" })];

    const result = createReleasePlan({
      packages,
      targets: ["sdk"],
      publishAll: false,
      getRegistryVersion: registry({ sdk: "0.9.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages,
        registryVersions: new Map([["sdk", "0.9.0"]]),
      },
    });
  });

  test("orders dependents after dependencies when both are selected", () => {
    const packages = [
      pkg("app", "1.0.0", { sdk: "workspace:*" }),
      pkg("plugin", "1.0.0"),
      pkg("sdk", "1.0.0"),
    ];

    const result = createReleasePlan({
      packages,
      targets: ["app", "plugin"],
      publishAll: false,
      getRegistryVersion: registry({ app: "0.9.0", plugin: "0.9.0", sdk: "0.9.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages: [packages[1], packages[2], packages[0]],
        registryVersions: new Map([
          ["app", "0.9.0"],
          ["plugin", "0.9.0"],
          ["sdk", "0.9.0"],
        ]),
      },
    });
  });

  test("handles packages without dependency metadata", () => {
    const packageWithoutDependencies: PackageInfo = {
      name: "pkg",
      version: "1.0.0",
      path: "/repo/pkg",
      pkg: { name: "pkg", version: "1.0.0" },
      isRoot: false,
    };

    const result = createReleasePlan({
      packages: [packageWithoutDependencies],
      targets: ["pkg"],
      publishAll: false,
      getRegistryVersion: registry({ pkg: "0.9.0" }),
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        packages: [packageWithoutDependencies],
        registryVersions: new Map([["pkg", "0.9.0"]]),
      },
    });
  });

  test("collectDependencies returns the transitive workspace closure", () => {
    const packages = [
      pkg("root", "1.0.0", { ext: "workspace:*" }),
      pkg("ext", "1.0.0", { sdk: "workspace:*" }),
      pkg("sdk", "1.0.0"),
    ];
    const nameMap = new Map(packages.map((p) => [p.name, p]));

    expect(collectDependencies("ext", nameMap, new Set<string>())).toEqual(new Set(["ext", "sdk"]));
  });
});
