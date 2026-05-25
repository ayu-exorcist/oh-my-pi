import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isStringArray } from "./guards";
import type { PackageInfo } from "./types";

/**
 * Build a Markdown changelog entry listing every bundled dependency
 * and the exact version that was just published.
 */
export function generateChangelogEntry(
  rootPkg: PackageInfo,
  publishedVersions: Map<string, string>,
): string {
  const date = new Date().toISOString().split("T")[0];
  const deps = rootPkg.pkg.dependencies || {};
  const bundled: string[] = isStringArray(rootPkg.pkg.bundledDependencies)
    ? rootPkg.pkg.bundledDependencies
    : [];

  const lines: string[] = [];
  lines.push(`## ${rootPkg.name}@${rootPkg.version} (${date})`);
  lines.push("");

  for (const dep of bundled) {
    const version = publishedVersions.get(dep) || deps[dep] || "unknown";
    lines.push(`- ${dep}@${version}`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Prepend the new changelog entry to `CHANGELOG.md`. */
export function updateChangelog(
  root: string,
  rootPkg: PackageInfo,
  publishedVersions: Map<string, string>,
): void {
  const changelogPath = join(root, "CHANGELOG.md");
  const entry = generateChangelogEntry(rootPkg, publishedVersions);

  let existing = "";
  try {
    existing = readFileSync(changelogPath, "utf8");
  } catch {
    existing = "# Changelog\n\n";
  }

  const newContent = existing.replace(/# Changelog\n\n/, `# Changelog\n\n${entry}`);
  writeFileSync(changelogPath, newContent, "utf8");
  console.log("📝 Updated CHANGELOG.md\n");
}
