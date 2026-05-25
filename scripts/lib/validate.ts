import { isRecord, isStringArray } from "./guards";
import type { PackageInfo, ValidationError } from "./types";

/** Determine whether a package is root / extension / sdk. */
export function getPackageKind(pkg: PackageInfo): "root" | "extension" | "sdk" {
  if (pkg.isRoot) return "root";
  const normalized = pkg.path.replace(/\\/g, "/");
  if (normalized.includes("/extensions/")) return "extension";
  if (normalized.includes("/sdk/")) return "sdk";
  return "root";
}

/** Validate a single package's manifest. */
export function validatePackage(pkg: PackageInfo): ValidationError[] {
  const errors: ValidationError[] = [];
  const kind = getPackageKind(pkg);
  const { name, pkg: json } = pkg;

  // files must include README.md
  const files = json.files;
  if (!Array.isArray(files) || !files.some((f) => f === "README.md")) {
    errors.push({ pkg: name, field: "files", message: 'must include "README.md"' });
  }

  // repository
  const repo = json.repository;
  if (!isRecord(repo)) {
    errors.push({ pkg: name, field: "repository", message: "is required" });
  } else {
    if (typeof repo.url !== "string" || !repo.url) {
      errors.push({ pkg: name, field: "repository.url", message: "is required" });
    }
    if (!pkg.isRoot && (typeof repo.directory !== "string" || !repo.directory)) {
      errors.push({
        pkg: name,
        field: "repository.directory",
        message: "is required for workspace packages",
      });
    }
  }

  // homepage
  if (typeof json.homepage !== "string" || !json.homepage) {
    errors.push({ pkg: name, field: "homepage", message: "is required" });
  }

  // bugs
  if (!isRecord(json.bugs)) {
    errors.push({ pkg: name, field: "bugs", message: "is required" });
  }

  // publishConfig.access
  const publishConfig = json.publishConfig;
  if (!isRecord(publishConfig) || publishConfig.access !== "public") {
    errors.push({ pkg: name, field: "publishConfig.access", message: 'must be "public"' });
  }

  // keywords: pi-package
  const keywords = Array.isArray(json.keywords) ? json.keywords : [];
  const hasPiPackage = keywords.includes("pi-package");
  if (kind === "sdk" && hasPiPackage) {
    errors.push({
      pkg: name,
      field: "keywords",
      message: 'must NOT include "pi-package" (SDK packages are not Pi extensions)',
    });
  }
  if ((kind === "extension" || kind === "root") && !hasPiPackage) {
    errors.push({ pkg: name, field: "keywords", message: 'must include "pi-package"' });
  }

  // pi.extensions
  const pi = json.pi;
  const hasPiExtensions = isRecord(pi) && Array.isArray(pi.extensions);
  if ((kind === "extension" || kind === "root") && !hasPiExtensions) {
    errors.push({ pkg: name, field: "pi.extensions", message: "is required" });
  }
  if (kind === "sdk" && hasPiExtensions) {
    errors.push({
      pkg: name,
      field: "pi.extensions",
      message: "must NOT be set (SDK packages are not extensions)",
    });
  }

  return errors;
}

/** Validate root package consistency (bundledDeps vs dependencies). */
export function validateRootConsistency(
  rootPkg: PackageInfo,
  workspacePkgs: PackageInfo[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const deps = rootPkg.pkg.dependencies || {};
  const bundled: string[] = isStringArray(rootPkg.pkg.bundledDependencies)
    ? rootPkg.pkg.bundledDependencies
    : [];
  const workspaceNames = new Set(workspacePkgs.map((p) => p.name));

  for (const depName of bundled) {
    if (!deps[depName]) {
      errors.push({
        pkg: rootPkg.name,
        field: "bundledDependencies",
        message: `"${depName}" is bundled but not in dependencies`,
      });
    }
  }

  for (const [depName] of Object.entries(deps)) {
    if (workspaceNames.has(depName) && !bundled.includes(depName)) {
      errors.push({
        pkg: rootPkg.name,
        field: "dependencies",
        message: `"${depName}" is a workspace dependency but not in bundledDependencies`,
      });
    }
  }

  return errors;
}
