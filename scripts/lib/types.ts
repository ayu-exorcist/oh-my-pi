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
  readonly name: string;
  readonly version: string;
  readonly path: string;
  readonly pkg: PkgJson;
  readonly isRoot: boolean;
}

export interface ValidationError {
  readonly pkg: string;
  readonly field: string;
  readonly message: string;
}

export interface DepGraph {
  readonly graph: ReadonlyMap<string, readonly string[]>;
  readonly inDegree: ReadonlyMap<string, number>;
  readonly nameMap: ReadonlyMap<string, PackageInfo>;
}
