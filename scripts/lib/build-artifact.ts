import { isRecord } from "./guards";

export interface MaterializeBuildArtifactManifestOptions {
  readonly pkgJson: Record<string, unknown>;
  readonly workspacePackageNames: ReadonlySet<string>;
}

/** Rewrite TS source paths to distribution paths for dist/package.json. */
function rewritePaths(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/^\.\/src\//, "./")
      .replace(/^src\//, "")
      .replace(/\.d\.ts$/, ".d.mjs")
      .replace(/\.ts$/, ".mjs");
  }
  if (Array.isArray(value)) {
    return value.map(rewritePaths);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, rewritePaths(nested)]),
    );
  }
  return value;
}

export function materializeBuildArtifactManifest(
  options: MaterializeBuildArtifactManifestOptions,
): Record<string, unknown> {
  const pkgJson = { ...options.pkgJson };

  if (pkgJson.main) pkgJson.main = rewritePaths(pkgJson.main);
  if (pkgJson.types) pkgJson.types = rewritePaths(pkgJson.types);
  if (pkgJson.exports) pkgJson.exports = rewritePaths(pkgJson.exports);

  const pi = pkgJson.pi;
  if (isRecord(pi) && pi.extensions) {
    pi.extensions = rewritePaths(pi.extensions);
  }

  delete pkgJson.scripts;
  delete pkgJson.devDependencies;
  delete pkgJson.files;

  const deps = pkgJson.dependencies;
  if (isRecord(deps)) {
    pkgJson.dependencies = Object.fromEntries(
      Object.entries(deps).filter(([dep]) => !options.workspacePackageNames.has(dep)),
    );
  }

  return pkgJson;
}
