import { execSync } from "node:child_process";

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function pathArgs(paths: readonly string[]): string {
  return paths.length > 0 ? ` -- ${paths.map(quote).join(" ")}` : "";
}

/** Return whether a git ref exists. */
export function hasRef(root: string, ref: string): boolean {
  try {
    execSync(`git rev-parse --verify ${ref}`, {
      cwd: root,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether files under `paths` changed between `ref` and `HEAD`.
 */
export function hasCommittedPathChangesSinceRef(
  root: string,
  ref: string,
  paths: readonly string[],
): boolean {
  const scoped = pathArgs(paths);

  try {
    const committed = execSync(`git diff --name-only ${ref}..HEAD${scoped}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return committed.trim().length > 0;
  } catch {
    return true;
  }
}

/**
 * Detect whether files under `paths` changed since `ref` or remain dirty in the
 * current worktree.
 */
export function hasPathChangesSinceRef(
  root: string,
  ref: string,
  paths: readonly string[],
): boolean {
  const scoped = pathArgs(paths);

  try {
    const committed = execSync(`git diff --name-only ${ref}..HEAD${scoped}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (committed.trim().length > 0) return true;
  } catch {
    // If the ref does not exist or the diff fails, fall back to a dirty check.
  }

  try {
    const dirty = execSync(`git status --porcelain --untracked-files=all${scoped}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return dirty.trim().length > 0;
  } catch {
    return true;
  }
}

/** Stage the given paths for commit. */
export function stagePaths(root: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  execSync(`git add -A -- ${paths.map(quote).join(" ")}`, { cwd: root, stdio: "pipe" });
}

/** Create a commit. */
export function commit(root: string, message: string): void {
  execSync(`git commit -m ${quote(message)}`, { cwd: root, stdio: "pipe" });
}

/** Push the current branch to origin. */
export function pushCurrentBranch(root: string): void {
  execSync("git push origin HEAD", { cwd: root, stdio: "pipe" });
}

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
