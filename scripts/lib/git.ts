import { execSync } from "node:child_process";

/** Create a git tag for a single published package, skip if already exists. */
export function createTag(root: string, name: string, version: string): string | null {
  const tag = `${name}@${version}`;
  try {
    execSync(`git rev-parse --verify refs/tags/${tag}`, {
      cwd: root,
      stdio: "pipe",
    });
    console.log(`🏷️ Tag ${tag} already exists, skipping`);
    return null;
  } catch {
    try {
      execSync(`git tag ${tag}`, { cwd: root, stdio: "pipe" });
      console.log(`🏷️ Created tag ${tag}`);
      return tag;
    } catch (err) {
      console.warn(`⚠️ Failed to create tag ${tag}:`, err);
      return null;
    }
  }
}

/** Push a single tag to origin. */
export function pushTag(root: string, tag: string): void {
  try {
    execSync(`git push origin ${tag}`, { cwd: root, stdio: "pipe" });
    console.log(`🚀 Pushed tag: ${tag}`);
  } catch (err) {
    console.warn(`⚠️ Failed to push tag ${tag}:`, err);
  }
}

/** Create a GitHub Release for a single tag. */
export function createRelease(root: string, tag: string): void {
  try {
    execSync(`gh release create "${tag}" --title "${tag}" --generate-notes`, {
      cwd: root,
      stdio: "pipe",
    });
    console.log(`📋 Created GitHub Release ${tag}`);
  } catch (err) {
    console.warn(`⚠️ Failed to create GitHub Release ${tag}:`, err);
  }
}

/** Full pipeline for a single published package: tag → push → release. */
export function tagAndRelease(root: string, name: string, version: string): void {
  const tag = createTag(root, name, version);
  if (!tag) return;
  pushTag(root, tag);
  createRelease(root, tag);
}

/** Batch variants (kept for backwards compatibility). */

/** Create git tags for published packages, skip existing ones. */
export function createTags(root: string, publishedVersions: Map<string, string>): string[] {
  const newTags: string[] = [];
  for (const [name, version] of publishedVersions) {
    const tag = createTag(root, name, version);
    if (tag) newTags.push(tag);
  }
  return newTags;
}

/** Push newly created tags to origin. */
export function pushTags(root: string, tags: string[]): void {
  if (tags.length === 0) return;
  try {
    execSync(`git push origin ${tags.join(" ")}`, {
      cwd: root,
      stdio: "pipe",
    });
    console.log(`🚀 Pushed tags: ${tags.join(", ")}\n`);
  } catch (err) {
    console.warn(`⚠️ Failed to push tags:`, err);
  }
}

/** Create GitHub Releases for new tags. */
export function createReleases(root: string, tags: string[]): void {
  for (const tag of tags) {
    createRelease(root, tag);
  }
}
