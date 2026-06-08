import { describe, expect, test } from "vitest";
import { applyPromptArguments, loadPrompt, promptFiles, stripFrontmatter } from "./prompts";

describe("Ayu prompt templates", () => {
  test("strips leading frontmatter", () => {
    expect(stripFrontmatter("---\ndescription: Test\n---\nBody")).toBe("Body");
    expect(stripFrontmatter("---\r\ndescription: Test\r\n---\r\nBody")).toBe("Body");
    expect(stripFrontmatter("Body only")).toBe("Body only");
  });

  test("substitutes both supported argument placeholders after stripping frontmatter", () => {
    const result = applyPromptArguments(
      "---\ndescription: Test\n---\nTask: $ARGUMENTS\nAgain: $@",
      "ship it",
    );
    expect(result).toBe("Task: ship it\nAgain: ship it");
  });

  test("loads bundled prompts by command alias", async () => {
    await expect(loadPrompt("task", "add tests")).resolves.toContain("Task input:\nadd tests");
    await expect(loadPrompt("goal", "finish coverage")).resolves.toContain("Goal: finish coverage");
    await expect(loadPrompt("plan", "coverage")).resolves.toContain("Goal: coverage");
    await expect(loadPrompt("bug", "failing test")).resolves.toContain("Bug: failing test");
    await expect(loadPrompt("review", "security")).resolves.toContain("Focus: security");
    await expect(loadPrompt("review-diff", "docs")).resolves.toContain("Focus: docs");
    await expect(loadPrompt("docs", "README")).resolves.toContain("Scope: README");
    await expect(loadPrompt("docs-sync", "README")).resolves.toContain("Scope: README");
    await expect(loadPrompt("release", "0.1.0")).resolves.toContain("for: 0.1.0");
    await expect(loadPrompt("release-check", "next")).resolves.toContain("for: next");
    await expect(loadPrompt("verify", "ci")).resolves.toContain("ci");
    await expect(loadPrompt("audit", "repo")).resolves.toContain("Scope: repo");
    await expect(loadPrompt("journal", "decisions")).resolves.toContain("decisions");
    await expect(loadPrompt("harness-iteration", "failure")).resolves.toContain("failure");
    await expect(loadPrompt("benchmark", "suite-a")).resolves.toContain("suite-a");
  });

  test("returns undefined for unknown prompt names", async () => {
    await expect(loadPrompt("unknown", "args")).resolves.toBeUndefined();
    expect(promptFiles.task).toBe("task.md");
  });
});
