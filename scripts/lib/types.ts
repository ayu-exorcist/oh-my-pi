/** Directories scanned for publishable workspace packages (excluding the root). */
export const PUBLISHABLE_WORKSPACE_DIRS = ["extensions", "sdk"] as const;

/** Directories scanned as release inputs, including private internal packages. */
export const RELEASE_INPUT_WORKSPACE_DIRS = ["extensions", "sdk", "internal"] as const;

export interface PkgJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  private?: boolean;
  bundledDependencies?: unknown;
  files?: unknown;
  repository?: unknown;
  homepage?: unknown;
  bugs?: unknown;
  publishConfig?: unknown;
  keywords?: unknown;
  pi?: unknown;
  [key: string]: unknown;
}

export interface PackageInfo {
  name: string;
  version: string;
  path: string;
  pkg: PkgJson;
  isRoot: boolean;
}

export interface ValidationError {
  pkg: string;
  field: string;
  message: string;
}

export interface DepGraph {
  graph: Map<string, string[]>;
  inDegree: Map<string, number>;
  nameMap: Map<string, PackageInfo>;
}
