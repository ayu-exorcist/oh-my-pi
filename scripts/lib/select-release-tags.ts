/** Parse one tag per line from `git tag --points-at HEAD`. */
export function parseLocalTagList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Parse tag names from `git ls-remote --tags --refs origin`. */
export function parseRemoteTagList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const columns = line.split(/\s+/);
      const ref = columns[1];
      if (!ref) return [];
      const tagPrefix = "refs/tags/";
      if (!ref.startsWith(tagPrefix)) return [];
      return [ref.slice(tagPrefix.length)];
    });
}

/** Return the tags that exist locally but not on the remote. */
export function selectReleaseTagsToPush(
  localTags: readonly string[],
  remoteTags: readonly string[],
): string[] {
  const remoteTagSet = new Set(remoteTags);
  return [...new Set(localTags.filter((tag) => !remoteTagSet.has(tag)))].sort();
}
