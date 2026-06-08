import { describe, expect, it } from "vitest";

import {
  extractExternalPathsFromBashCommand,
  extractTokensForPathRules,
} from "#src/handlers/gates/bash-path-extractor";

describe("bash path extractor edge cases", () => {
  it("skips assignments, URLs, package scopes, regex tokens, and bare slashes", async () => {
    await expect(
      extractTokensForPathRules(
        "FOO=bar cat ./file.txt ../outside.txt C:\\Temp\\log.txt @scope/pkg https://example.com foo.* bar+ [abc] / --literal",
      ),
    ).resolves.toEqual(["./file.txt", "../outside.txt", "C:\\Temp\\log.txt"]);
  });

  it("handles quoted strings, nested command substitution, and redirects", async () => {
    await expect(
      extractTokensForPathRules(
        "cat './quoted.txt' \"./double.txt\" $(cat ../nested.txt) > ./out.txt",
      ),
    ).resolves.toEqual(["./quoted.txt", "./double.txt", "../nested.txt", "./out.txt"]);
  });

  it("skips inline scripts for pattern-first commands and keeps path-like file arguments", async () => {
    await expect(
      extractTokensForPathRules("sed -e 's/a/b/' -f ./rules.txt ./input.txt"),
    ).resolves.toEqual(["./rules.txt", "./input.txt"]);
  });

  it("skips the first two inline arguments for sd and keeps path arguments", async () => {
    await expect(extractTokensForPathRules("sd foo bar src/index.ts")).resolves.toEqual([
      "src/index.ts",
    ]);
  });

  it("deduplicates repeated rule candidates", async () => {
    await expect(extractTokensForPathRules("cat ./file.txt ./file.txt")).resolves.toEqual([
      "./file.txt",
    ]);
  });

  it("returns external paths relative to a leading cd that stays within cwd", async () => {
    const paths = await extractExternalPathsFromBashCommand(
      "cd subdir && cat ../../outside.txt",
      "/workspace/project",
    );
    expect(paths).toEqual(["/workspace/outside.txt"]);
  });

  it("falls back to cwd when leading cd is home-relative or dash", async () => {
    const dashPaths = await extractExternalPathsFromBashCommand(
      "cd - && cat ../outside.txt",
      "/workspace/project",
    );
    const homePaths = await extractExternalPathsFromBashCommand(
      "cd ~ && cat ../outside.txt",
      "/workspace/project",
    );

    expect(dashPaths).toEqual(["/workspace/outside.txt"]);
    expect(homePaths).toEqual(["/workspace/outside.txt"]);
  });

  it("deduplicates repeated external paths and ignores safe system paths", async () => {
    await expect(
      extractExternalPathsFromBashCommand("cat /etc/hosts /etc/hosts /dev/null", "/workspace"),
    ).resolves.toEqual(["/etc/hosts"]);
  });

  it("returns no paths for an empty command", async () => {
    await expect(extractTokensForPathRules("")).resolves.toEqual([]);
  });
});
