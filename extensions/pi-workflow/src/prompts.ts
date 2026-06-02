import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const promptFiles: Record<string, string> = {
  audit: "audit.md",
  task: "task.md",
  review: "review-diff.md",
  "review-diff": "review-diff.md",
  docs: "docs-sync.md",
  "docs-sync": "docs-sync.md",
  release: "release-check.md",
  "release-check": "release-check.md",
  verify: "verify.md",
  journal: "journal.md",
};

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export function stripFrontmatter(template: string): string {
  return template.replace(/^---\r?\n[\s\S]*?\r?---\r?\n?/, "");
}

export function applyPromptArguments(template: string, args: string): string {
  return stripFrontmatter(template).replaceAll("$ARGUMENTS", args).replaceAll("$@", args);
}

export async function loadPrompt(name: string, args: string): Promise<string | undefined> {
  const file = promptFiles[name];
  if (!file) return undefined;

  const template = await readFile(join(packageDir, "prompts", file), "utf8");
  return applyPromptArguments(template, args);
}
