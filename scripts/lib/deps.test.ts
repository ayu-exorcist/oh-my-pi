import { describe, expect, test } from "vitest";

import { buildDepGraph, collectDependencies, topoSort } from "./deps";
import type { PackageInfo } from "./types";

function pkg(name: string, dependencies: Record<string, string> = {}): PackageInfo {
  return {
    name,
    version: "1.0.0",
    path: `/repo/${name}`,
    pkg: { name, version: "1.0.0", dependencies },
    isRoot: false,
  };
}

describe("dependency graph helpers", () => {
  test("builds graph edges from workspace dependencies only", () => {
    const packages = [
      pkg("app", { sdk: "workspace:*", external: "^1.0.0" }),
      pkg("plugin", { sdk: "workspace:*" }),
      { ...pkg("sdk"), pkg: { name: "sdk", version: "1.0.0" } },
    ];

    const graph = buildDepGraph(packages);

    expect(graph.graph).toEqual(
      new Map([
        ["app", []],
        ["plugin", []],
        ["sdk", ["app", "plugin"]],
      ]),
    );
    expect(graph.inDegree).toEqual(
      new Map([
        ["app", 1],
        ["plugin", 1],
        ["sdk", 0],
      ]),
    );
    expect(graph.nameMap.get("app")).toBe(packages[0]);
  });

  test("sorts dependencies before dependents", () => {
    const packages = [pkg("app", { sdk: "workspace:*" }), pkg("sdk")];
    const graph = buildDepGraph(packages);

    expect(topoSort(["app", "sdk"], graph.graph, graph.inDegree)).toEqual(["sdk", "app"]);
  });

  test("stops when queue contains an empty name", () => {
    expect(topoSort([""], new Map([["", []]]), new Map([["", 0]]))).toEqual([]);
  });

  test("skips visited names, missing children, and missing in-degree entries", () => {
    const graph = new Map<string, string[]>([
      ["a", ["b", "missing-degree"]],
      ["b", []],
    ]);
    const inDegree = new Map<string, number>([
      ["a", 0],
      ["b", 1],
      ["missing-children", 0],
    ]);

    expect(topoSort(["a", "a", "missing-children"], graph, inDegree)).toEqual([
      "a",
      "missing-children",
      "b",
    ]);
  });

  test("returns partial order for cycles", () => {
    const graph = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    const inDegree = new Map<string, number>([
      ["a", 1],
      ["b", 1],
    ]);

    expect(topoSort(["a", "b"], graph, inDegree)).toEqual([]);
  });

  test("collects transitive workspace dependencies and handles repeats", () => {
    const packages = [
      pkg("app", { sdk: "workspace:*" }),
      pkg("sdk", { core: "workspace:*" }),
      pkg("core"),
    ];
    const nameMap = new Map(packages.map((current) => [current.name, current]));

    expect(collectDependencies("app", nameMap)).toEqual(new Set(["app", "sdk", "core"]));
    expect(collectDependencies("app", nameMap, new Set(["app"]))).toEqual(new Set(["app"]));
    expect(collectDependencies("missing", nameMap)).toEqual(new Set(["missing"]));
  });
});
