#!/usr/bin/env oxnode
import { fileURLToPath } from "node:url";

import { parseCLI } from "./lib/cli";
import { parseReleaseRunOptions, rejectUnsupportedReleaseArgs } from "./lib/release-args";
import { publishPackages } from "./publish-packages";
import { syncReleaseTags } from "./sync-release-tags";

export async function runRelease(): Promise<void> {
  const { flags, positionals } = parseCLI();
  if (!rejectUnsupportedReleaseArgs(flags, positionals)) return;

  const { dryRun, otp } = parseReleaseRunOptions(flags);
  await publishPackages({ dryRun, otp });
  if (!dryRun) syncReleaseTags();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runRelease().catch((err: unknown) => {
    console.error(err);
    /* c8 ignore next */
    process.exit(1);
  });
}
