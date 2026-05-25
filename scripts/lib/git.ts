import { execSync } from "node:child_process";

/** Create git tags for published packages, skip existing ones. */
export function createTags(root: string, publishedVersions: Map<string, string>): string[] {
  const newTags: string[] = [];
  for (const [name, version] of publishedVersions) {
    const tag = `${name}@${version}`;
    try {
      execSync(`git rev-parse --verify refs/tags/${tag}`, {
        cwd: root,
        stdio: "pipe",
      });
      console.log(`🏷️ Tag ${tag} already exists, skipping`);
    } catch {
      try {
        execSync(`git tag ${tag}`, { cwd: root, stdio: "pipe" });
        newTags.push(tag);
        console.log(`🏷️ Created tag ${tag}`);
      } catch (err) {
        console.warn(`⚠️ Failed to create tag ${tag}:`, err);
      }
    }
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
}
