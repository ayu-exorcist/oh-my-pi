#!/usr/bin/env oxnode
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseLocalTagList,
  parseRemoteTagList,
  selectReleaseTagsToPush,
} from "./lib/select-release-tags";

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8" });
}

export function syncReleaseTags(): void {
  const localTags = parseLocalTagList(git(["tag", "--points-at", "HEAD"]));
  const remoteTags = parseRemoteTagList(git(["ls-remote", "--tags", "--refs", "origin"]));
  const tags = selectReleaseTagsToPush(localTags, remoteTags);

  if (tags.length === 0) {
    console.error("No release tags were created on HEAD.");
    /* c8 ignore next */
    process.exit(1);
  }

  execFileSync("git", ["push", "--no-verify", "origin", ...tags], { stdio: "inherit" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  syncReleaseTags();
}
