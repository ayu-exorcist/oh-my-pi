import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("./lib/npm", () => ({
  getNpmUser: vi.fn(() => "ayu.exorcist"),
  getRegistryVersion: vi.fn(() => "0.3.2"),
  setRoot: vi.fn(),
}));

vi.mock("./lib/packages", () => ({
  getPackages: vi.fn(() => []),
}));

vi.mock("./lib/deps", () => ({
  buildDepGraph: vi.fn(() => ({ nameMap: new Map() })),
  collectDependencies: vi.fn(() => new Set()),
}));

vi.mock("./lib/release-plan", () => ({
  createReleasePlan: vi.fn(),
  collectReleaseScope: vi.fn(() => new Set()),
}));

vi.mock("./lib/build-artifact-stage", () => ({
  stageBundledBuildArtifacts: vi.fn(() => ({ ok: true, restores: [] })),
}));

vi.mock("./lib/validate", () => ({
  validatePackage: vi.fn(() => []),
  validateRootConsistency: vi.fn(() => []),
}));

vi.mock("./lib/cli", () => ({
  parseCLI: vi.fn(() => ({ flags: new Map(), positionals: [] })),
}));

vi.mock("./lib/auto-bump", () => ({
  planAutoBumps: vi.fn(() => []),
}));

vi.mock("./lib/release-preview", () => ({
  applyAutoBumpPlanToPackages: vi.fn((packages: readonly unknown[]) => packages),
  buildReleasePreviewRows: vi.fn(() => []),
}));

import { findUncommittedReleasePackages } from "./publish";
import { execSync as mockedExecSync } from "node:child_process";
import { collectDependencies as mockedCollectDependencies } from "./lib/deps";

const mockExecSync = vi.mocked(mockedExecSync);
const mockCollectDependencies = vi.mocked(mockedCollectDependencies);

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
      if (
        command ===
        'git diff --name-only HEAD..HEAD -- "package.json" "README.md" "prompts" "skills" "themes"'
      ) {
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
