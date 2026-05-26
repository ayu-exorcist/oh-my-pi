/** Simple CLI parser for --key, --key=value, -k, and -k value flags. */
export function parseCLI(): {
  flags: Map<string, string | true>;
  positionals: string[];
} {
  let args = process.argv.slice(2);
  // pnpm may pass a leading `--` separator; drop it if present.
  if (args[0] === "--") args = args.slice(1);

  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) break;
    if (a === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags.set(a.slice(2), next);
          i++;
        } else {
          flags.set(a.slice(2), true);
        }
      }
      continue;
    }
    if (a.startsWith("-") && a.length === 2) {
      const key = a[1];
      if (key === undefined) continue;
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    positionals.push(a);
  }

  return { flags, positionals };
}
