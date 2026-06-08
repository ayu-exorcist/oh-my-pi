import { afterEach, describe, expect, test } from "vitest";

import { parseCLI } from "./cli";

const originalArgv = process.argv;

function withArgv(args: string[]) {
  process.argv = ["node", "script.ts", ...args];
}

afterEach(() => {
  process.argv = originalArgv;
});

describe("CLI parser", () => {
  test("parses long flags, short flags, values, and positionals", () => {
    withArgv(["--dry-run", "--access=public", "--output", "dist", "-p", "pkg", "target"]);

    const parsed = parseCLI();

    expect(parsed.flags).toEqual(
      new Map<string, string | true>([
        ["dry-run", true],
        ["access", "public"],
        ["output", "dist"],
        ["p", "pkg"],
      ]),
    );
    expect(parsed.positionals).toEqual(["target"]);
  });

  test("drops a leading pnpm separator and preserves args after -- as positionals", () => {
    withArgv(["--", "--all", "--", "--literal", "value"]);

    const parsed = parseCLI();

    expect(parsed.flags).toEqual(new Map<string, string | true>([["all", true]]));
    expect(parsed.positionals).toEqual(["--literal", "value"]);
  });

  test("treats missing flag values and unsupported short forms conservatively", () => {
    withArgv(["--otp", "-a", "-abc"]);

    const parsed = parseCLI();

    expect(parsed.flags).toEqual(
      new Map<string, string | true>([
        ["otp", true],
        ["a", true],
      ]),
    );
    expect(parsed.positionals).toEqual(["-abc"]);
  });

  test("treats a short flag with a value as an assigned option", () => {
    withArgv(["-p", "pkg", "--", "tail"]);

    const parsed = parseCLI();

    expect(parsed.flags).toEqual(new Map<string, string | true>([["p", "pkg"]]));
    expect(parsed.positionals).toEqual(["tail"]);
  });

  test("treats repeated positional args and empty input consistently", () => {
    withArgv([]);
    expect(parseCLI()).toEqual({ flags: new Map(), positionals: [] });

    withArgv(["file.ts", "--flagless"]);
    const parsed = parseCLI();
    expect(parsed.positionals).toEqual(["file.ts"]);
    expect(parsed.flags).toEqual(new Map([["flagless", true]]));
  });

  test("handles malformed argv entries defensively", () => {
    process.argv = ["node", "script.ts", undefined as unknown as string, "tail"];
    expect(parseCLI()).toEqual({ flags: new Map(), positionals: [] });

    const shortFlagLike = {
      length: 2,
      startsWith(prefix: string) {
        return prefix === "-";
      },
    } as unknown as string;
    process.argv = ["node", "script.ts", shortFlagLike, "tail"];
    expect(parseCLI()).toEqual({ flags: new Map(), positionals: ["tail"] });
  });
});
