#!/usr/bin/env oxnode
import { execFileSync } from "node:child_process";

function run(command: string, args: readonly string[]): void {
  execFileSync(command, [...args], { stdio: "inherit" });
}

function stagedFiles(): string[] {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  });

  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

const filesToRestage = stagedFiles();

run("pnpm", ["run", "fmt"]);
run("pnpm", ["run", "lint:fix"]);

if (filesToRestage.length > 0) {
  run("git", ["add", "--", ...filesToRestage]);
}

run("pnpm", ["run", "check"]);
