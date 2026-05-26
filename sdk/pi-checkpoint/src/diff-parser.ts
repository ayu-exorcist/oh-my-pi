import type { FileChange } from "./types";

/**
 * Parse `git diff --numstat` output into structured file changes.
 *
 * Expected line format: `<added>\t<removed>\t<path>`
 * Binary files show `-\t-\t<path>` and are mapped to `0/0`.
 * Non-standard lines fall back to `{ path: line, added: 0, removed: 0 }`.
 */
export function parseDiffStats(stdout: string): readonly FileChange[] {
  const lines = stdout.trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const parts = line.split("\t");
    const [addedRaw, removedRaw, filePath] = parts;
    if (addedRaw !== undefined && removedRaw !== undefined && filePath !== undefined) {
      return {
        path: filePath,
        added: parseInt(addedRaw, 10) || 0,
        removed: parseInt(removedRaw, 10) || 0,
      };
    }
    return { path: line, added: 0, removed: 0 };
  });
}
