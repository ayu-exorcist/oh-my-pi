import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, signal: null })),
}));

vi.mock("./lib/packages", () => ({
  getPackages: vi.fn(() => []),
  getReleaseInputWorkspacePackages: vi.fn(() => []),
}));

vi.mock("./lib/deps", () => ({
  buildDepGraph: vi.fn(() => ({ nameMap: new Map() })),
  collectDependencies: vi.fn(() => new Set()),
}));

vi.mock("./lib/git", () => ({
  hasPathChangesSinceRef: vi.fn(() => false),
}));

vi.mock("./lib/validate", () => ({
  validatePackage: vi.fn(() => []),
  validateRootConsistency: vi.fn(() => []),
}));

vi.mock("./lib/cli", () => ({
  parseCLI: vi.fn(() => ({ flags: new Map(), positionals: [] })),
}));

import { spawnSync as mockedSpawnSync } from "node:child_process";
import {
  buildDepGraph as mockedBuildDepGraph,
  collectDependencies as mockedCollectDependencies,
} from "./lib/deps";
import { hasPathChangesSinceRef as mockedHasPathChangesSinceRef } from "./lib/git";
import {
  getPackages as mockedGetPackages,
  getReleaseInputWorkspacePackages as mockedGetReleaseInputWorkspacePackages,
} from "./lib/packages";
import { parseCLI as mockedParseCLI } from "./lib/cli";
import {
  validatePackage as mockedValidatePackage,
  validateRootConsistency as mockedValidateRootConsistency,
} from "./lib/validate";
import {
  buildRootPublishManifest,
  createPublishWorkspace,
  findUncommittedReleasePackages,
} from "./publish-packages";

const mockSpawnSync = vi.mocked(mockedSpawnSync);
const mockBuildDepGraph = vi.mocked(mockedBuildDepGraph);
const mockCollectDependencies = vi.mocked(mockedCollectDependencies);
const mockHasPathChangesSinceRef = vi.mocked(mockedHasPathChangesSinceRef);
const mockGetPackages = vi.mocked(mockedGetPackages);
const mockGetReleaseInputWorkspacePackages = vi.mocked(mockedGetReleaseInputWorkspacePackages);
const mockParseCLI = vi.mocked(mockedParseCLI);
const mockValidatePackage = vi.mocked(mockedValidatePackage);
const mockValidateRootConsistency = vi.mocked(mockedValidateRootConsistency);

const repoRoot = process.cwd();

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

function createPublishFixture(manifest: Record<string, unknown>): string {
  const root = mkdtemp(join(tmpdir(), "publish-test-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

describe("release entry point", () => {
  let originalArgv1: string | undefined;

  beforeEach(() => {
    originalArgv1 = process.argv[1];
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0, signal: null } as never);
    mockBuildDepGraph.mockReset();
    mockCollectDependencies.mockReset();
    mockHasPathChangesSinceRef.mockReset();
    mockGetPackages.mockReset();
    mockGetReleaseInputWorkspacePackages.mockReset();
    mockParseCLI.mockReset();
    mockValidatePackage.mockReset();
    mockValidateRootConsistency.mockReset();
    mockCollectDependencies.mockImplementation((target: string) => new Set([target]));
    mockParseCLI.mockReturnValue({ flags: new Map(), positionals: [] } as never);
    mockHasPathChangesSinceRef.mockReturnValue(false);
    mockValidatePackage.mockReturnValue([] as never);
    mockValidateRootConsistency.mockReturnValue([] as never);
  });

  afterEach(() => {
    process.argv[1] = originalArgv1 ?? process.argv[1] ?? "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("reports packages with uncommitted release inputs", () => {
    const rootPkg = pkg("@ayulab/oh-my-pi", repoRoot);
    const nameMap = new Map([[rootPkg.name, rootPkg]]);
    mockHasPathChangesSinceRef.mockReturnValueOnce(true);

    expect(findUncommittedReleasePackages([rootPkg], nameMap)).toEqual(["@ayulab/oh-my-pi"]);
    expect(mockHasPathChangesSinceRef).toHaveBeenCalledWith(
      repoRoot,
      "HEAD",
      expect.arrayContaining(["package.json", "README.md", "themes"]),
    );
  });

  test("returns empty when release inputs are committed", () => {
    const rootPkg = pkg("@ayulab/oh-my-pi", repoRoot);
    const nameMap = new Map([[rootPkg.name, rootPkg]]);
    mockHasPathChangesSinceRef.mockReturnValueOnce(false);

    expect(findUncommittedReleasePackages([rootPkg], nameMap)).toEqual([]);
  });

  test("builds a stripped root publish manifest without mutating package.json", () => {
    const manifest = {
      name: "@ayulab/oh-my-pi",
      version: "0.4.1",
      scripts: { prepare: "simple-git-hooks" },
      devDependencies: { "simple-git-hooks": "^2.13.1" },
      engines: { node: ">=24.0.0" },
      publishConfig: { access: "public", scripts: { build: "noop" } },
      "simple-git-hooks": { "pre-commit": "pnpm run check" },
    };

    const stripped = buildRootPublishManifest(manifest);

    expect(stripped.scripts).toBeUndefined();
    expect(stripped.devDependencies).toBeUndefined();
    expect(stripped.engines).toBeUndefined();
    expect(stripped["simple-git-hooks"]).toBeUndefined();
    expect(stripped.publishConfig).toEqual({ access: "public" });
    expect((stripped.publishConfig as Record<string, unknown>).scripts).toBeUndefined();
    expect(manifest.scripts).toEqual({ prepare: "simple-git-hooks" });
  });

  test("rejects non-object root manifests", () => {
    expect(() => buildRootPublishManifest(null)).toThrow("package.json must be an object");
  });

  test("keeps missing publishConfig missing", () => {
    const stripped = buildRootPublishManifest({
      name: "@ayulab/oh-my-pi",
      version: "0.4.1",
      scripts: { prepare: "simple-git-hooks" },
      devDependencies: { "simple-git-hooks": "^2.13.1" },
      engines: { node: ">=24.0.0" },
    });

    expect(stripped.publishConfig).toBeUndefined();
  });

  test("creates an isolated publish workspace with stripped root manifest and package dist", () => {
    const root = createPublishFixture({
      name: "@ayulab/oh-my-pi",
      version: "0.4.1",
      scripts: { prepare: "simple-git-hooks" },
      devDependencies: { "simple-git-hooks": "^2.13.1" },
      engines: { node: ">=24.0.0" },
    });
    const extensionDir = join(root, "extensions", "example");
    mkdirSync(join(extensionDir, "dist"), { recursive: true });
    writeFileSync(join(root, "README.md"), "root readme\n");
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - extensions/*\n");
    writeFileSync(join(extensionDir, "package.json"), '{"name":"example","version":"1.0.0"}\n');
    writeFileSync(join(extensionDir, "dist", "index.js"), "export {};\n");

    try {
      const publishRoot = createPublishWorkspace(root, [pkg("example", extensionDir)]);
      try {
        const rootManifest = JSON.parse(readFileSync(join(publishRoot, "package.json"), "utf8"));
        expect(rootManifest.scripts).toBeUndefined();
        expect(readFileSync(join(root, "package.json"), "utf8")).toContain("simple-git-hooks");
        expect(readFileSync(join(publishRoot, "README.md"), "utf8")).toBe("root readme\n");
        expect(
          readFileSync(join(publishRoot, "extensions", "example", "dist", "index.js"), "utf8"),
        ).toBe("export {};\n");
      } finally {
        rmSync(publishRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("includes private internal workspace dependencies in release input paths", () => {
    const extension = pkg("@ayulab/example-extension", `${repoRoot}/extensions/example-extension`);
    const runtimeCore = pkg("@ayulab/runtime-core", `${repoRoot}/internal/runtime-core`);
    const nameMap = new Map([
      [extension.name, extension],
      [runtimeCore.name, runtimeCore],
    ]);

    mockCollectDependencies.mockReturnValueOnce(
      new Set(["@ayulab/example-extension", "@ayulab/runtime-core"]),
    );
    mockHasPathChangesSinceRef.mockReturnValueOnce(true);

    expect(findUncommittedReleasePackages([extension], nameMap)).toEqual([
      "@ayulab/example-extension",
    ]);
    const call = mockHasPathChangesSinceRef.mock.calls[0];
    expect(call?.[0]).toBe(repoRoot);
    expect(call?.[1]).toBe("HEAD");
    expect(call?.[2]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("extensions"),
        expect.stringContaining("internal"),
      ]),
    );
  });
});
