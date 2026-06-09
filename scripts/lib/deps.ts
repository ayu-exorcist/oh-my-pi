import type { PackageInfo, DepGraph } from "./types";

/**
 * Build a dependency graph from workspace `dependencies`.
 *
 * Edges point from a dependency → the package that depends on it so that
 * topological sorting yields dependents *after* their dependencies.
 */
export function buildDepGraph(packages: PackageInfo[]): DepGraph {
  const nameMap = new Map(packages.map((p) => [p.name, p]));
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const pkg of packages) {
    graph.set(pkg.name, []);
    inDegree.set(pkg.name, 0);
  }

  for (const pkg of packages) {
    const deps = pkg.pkg.dependencies || {};
    for (const depName of Object.keys(deps)) {
      if (nameMap.has(depName)) {
        const edges = graph.get(depName) ?? [];
        graph.set(depName, edges);
        const degree = inDegree.get(pkg.name) ?? 0;
        edges.push(pkg.name);
        inDegree.set(pkg.name, degree + 1);
      }
    }
  }

  return { graph, inDegree, nameMap };
}

/**
 * Kahn's algorithm — return `names` ordered so that dependencies come first.
 */
export function topoSort(
  names: string[],
  graph: Map<string, string[]>,
  baseInDegree: Map<string, number>,
): string[] {
  const inDegree = new Map(baseInDegree);
  const queue = [...names].filter((n) => inDegree.get(n) === 0);
  const result: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) break;
    if (visited.has(name)) continue;
    visited.add(name);
    result.push(name);
    const children = graph.get(name);
    if (!children) continue;
    for (const child of children) {
      const degree = inDegree.get(child)!;
      const newDegree = degree - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0 && !visited.has(child)) {
        queue.push(child);
      }
    }
  }

  return result;
}

/**
 * Recursively collect all workspace dependencies of `target` (transitive closure).
 */
export function collectDependencies(
  target: string,
  nameMap: Map<string, PackageInfo>,
  visited = new Set<string>(),
): Set<string> {
  if (visited.has(target)) return visited;
  visited.add(target);
  const pkg = nameMap.get(target);
  const deps = pkg?.pkg.dependencies || {};
  for (const depName of Object.keys(deps)) {
    if (nameMap.has(depName)) collectDependencies(depName, nameMap, visited);
  }
  return visited;
}
