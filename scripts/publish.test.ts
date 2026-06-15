import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./lib/packages", () => ({
  getPackages: vi.fn(() => []),
  getReleaseInputWorkspacePackages: vi.fn(() => []),
}));

vi.mock("./lib/deps", () => ({
  buildDepGraph: vi.fn(() => ({ nameMap: new Map() })),
  collectDependencies: vi.fn(() => new Set()),
}));

vi.mock("./lib/validate", () => ({
  validatePackage: vi.fn(() => []),
  validateRootConsistency: vi.fn(() => []),
}));

vi.mock("./lib/cli", () => ({
  parseCLI: vi.fn(() => ({ flags: new Map(), positionals: [] })),
}));

import { findUncommittedReleasePackages, stripRootManifestForPublish } from "./publish";
import { execSync as mockedExecSync } from "node:child_process";
import { collectDependencies as mockedCollectDependencies } from "./lib/deps";

const mockExecSync = vi.mocked(mockedExecSync);
const mockCollectDependencies = vi.mocked(mockedCollectDependencies);

function createPublishFixture(): string {
  const root = mkdtemp(join(tmpdir(), "publish-test-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "@ayulab/oh-my-pi",
        version: "0.4.1",
        scripts: { prepare: "simple-git-hooks" },
        devDependencies: { "simple-git-hooks": "^2.13.1" },
        engines: { node: ">=24.0.0" },
        publishConfig: { access: "public" },
        "simple-git-hooks": { "pre-commit": "pnpm run check" },
      },
      null,
      2,
    ),
  );
  return root;
}

function mkdtemp(prefix: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dir = `${prefix}${suffix}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pkg(name: string, path: string) {
  return {
    name,
    version: "0.3.1",
    path,
    pkg: { name, version: "0.3.1" },
    isRoot: name === "@ayulab/oh-my-pi",
  };
}

describe("release entry point", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockCollectDependencies.mockReset();
    mockCollectDependencies.mockImplementation((target: string) => new Set([target]));
  });

  afterEach(() => {
    vi.resetModules();
  });

  test("reports packages with uncommitted release inputs", () => {
    const root = "/repo";
    const rootPkg = pkg("@ayulab/oh-my-pi", root);
    const nameMap = new Map([[rootPkg.name, rootPkg]]);

    mockExecSync.mockImplementation((command: string) => {
      if (command.startsWith("git diff --name-only HEAD..HEAD")) {
        return "package.json\n" as never;
      }
      return "" as never;
    });

    expect(findUncommittedReleasePackages([rootPkg], nameMap)).toEqual(["@ayulab/oh-my-pi"]);
  });

  test("returns empty when release inputs are committed", () => {
    const rootPkg = pkg("@ayulab/oh-my-pi", "/repo");
    const nameMap = new Map([[rootPkg.name, rootPkg]]);

    mockExecSync.mockReturnValueOnce("" as never).mockReturnValueOnce("" as never);

    expect(findUncommittedReleasePackages([rootPkg], nameMap)).toEqual([]);
  });

  test("strips root development hooks while publishing and restores them afterward", () => {
    const root = createPublishFixture();
    const original = readFileSync(join(root, "package.json"), "utf8");

    try {
      const restore = stripRootManifestForPublish(root);
      const stripped = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

      expect(stripped.scripts).toBeUndefined();
      expect(stripped.devDependencies).toBeUndefined();
      expect(stripped.engines).toBeUndefined();
      expect(stripped["simple-git-hooks"]).toBeUndefined();
      expect(stripped.publishConfig).toEqual({ access: "public" });

      restore();
      expect(readFileSync(join(root, "package.json"), "utf8")).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("includes private internal workspace dependencies in release input paths", () => {
    const extension = pkg("@ayulab/pi-clarify", "/repo/extensions/pi-clarify");
    const runtimeCore = pkg("@ayulab/runtime-core", "/repo/internal/runtime-core");
    const nameMap = new Map([
      [extension.name, extension],
      [runtimeCore.name, runtimeCore],
    ]);

    mockCollectDependencies.mockReturnValueOnce(
      new Set(["@ayulab/pi-clarify", "@ayulab/runtime-core"]),
    );
    mockExecSync.mockImplementation((command: string) => {
      expect(command).toContain('"extensions/pi-clarify/src"');
      expect(command).toContain('"internal/runtime-core/src"');
      return "internal/runtime-core/src/guards.ts\n" as never;
    });

    expect(findUncommittedReleasePackages([extension], nameMap)).toEqual(["@ayulab/pi-clarify"]);
  });
});
