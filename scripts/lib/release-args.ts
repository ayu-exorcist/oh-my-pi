export interface ReleaseRunOptions {
  dryRun: boolean;
  otp: string | undefined;
}

export function parseReleaseRunOptions(
  flags: ReadonlyMap<string, string | true>,
): ReleaseRunOptions {
  return {
    dryRun: flags.has("dry-run"),
    otp: typeof flags.get("otp") === "string" ? String(flags.get("otp")) : undefined,
  };
}

export function rejectUnsupportedReleaseArgs(
  flags: ReadonlyMap<string, string | true>,
  positionals: readonly string[],
): boolean {
  const unsupported = ["package", "p", "all", "a", "access"].filter((name) => flags.has(name));
  if (unsupported.length === 0 && positionals.length === 0) return true;

  console.error("❌ Unsupported release arguments.");
  if (unsupported.length > 0) console.error(`   Flags: ${unsupported.join(", ")}`);
  if (positionals.length > 0) console.error(`   Positionals: ${positionals.join(", ")}`);
  console.error(
    "   Use Changesets to choose release packages and .changeset/config.json for access.",
  );
  /* c8 ignore next */
  process.exit(1);
}
