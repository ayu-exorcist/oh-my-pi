export interface ParsedReleaseTargets {
  readonly targets: readonly string[];
  readonly publishAll: boolean;
  readonly packageFlagProvided: boolean;
}

function splitTargets(values: readonly string[]): string[] {
  return values.flatMap((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function collectFlagValues(
  flags: ReadonlyMap<string, string | true>,
  names: readonly string[],
): string[] {
  const values: string[] = [];
  for (const name of names) {
    const value = flags.get(name);
    if (typeof value === "string") values.push(value);
  }
  return values;
}

export function parseReleaseTargets(
  flags: ReadonlyMap<string, string | true>,
  positionals: readonly string[],
): ParsedReleaseTargets {
  const allFlagProvided = flags.has("all") || flags.has("a");
  const packageFlagProvided = flags.has("package") || flags.has("p");
  const rawTargets = packageFlagProvided
    ? [...collectFlagValues(flags, ["package", "p"]), ...positionals]
    : [...positionals];
  const targets = splitTargets(rawTargets);

  return {
    targets,
    packageFlagProvided,
    publishAll: targets.length === 0 && (allFlagProvided || !packageFlagProvided),
  };
}
