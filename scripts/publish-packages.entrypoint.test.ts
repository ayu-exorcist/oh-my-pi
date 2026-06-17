import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let workspaceRoot = process.cwd();
let fixtureRoot = "";
let fixtureScriptsDir = "";
let publishEntrypoint = "";
let rootPackagePath = "";
let workspaceManifest = "";

vi.mock("node:url", async () => {
  const actual = await vi.importActual<typeof import("node:url")>("node:url");
  return {
    ...actual,
    fileURLToPath: (input: string | URL) => {
      const actualPath = actual.fileURLToPath(input);
      const normalizedPath = actualPath.replace(/\\/g, "/");
      if (normalizedPath.endsWith("/scripts/publish-packages.ts")) return publishEntrypoint;
      if (normalizedPath.endsWith("/scripts/") || normalizedPath.endsWith("/scripts")) {
        return fixtureScriptsDir;
      }
      return actualPath;
    },
  };
});

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

import { execSync as mockedExecSync } from "node:child_process";
import { buildDepGraph as mockedBuildDepGraph } from "./lib/deps";
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

const mockExecSync = vi.mocked(mockedExecSync);
const mockBuildDepGraph = vi.mocked(mockedBuildDepGraph);
const mockHasPathChangesSinceRef = vi.mocked(mockedHasPathChangesSinceRef);
const mockGetPackages = vi.mocked(mockedGetPackages);
const mockGetReleaseInputWorkspacePackages = vi.mocked(mockedGetReleaseInputWorkspacePackages);
const mockParseCLI = vi.mocked(mockedParseCLI);
const mockValidatePackage = vi.mocked(mockedValidatePackage);
const mockValidateRootConsistency = vi.mocked(mockedValidateRootConsistency);

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

function prepareRelease(flags = new Map<string, boolean | string>()) {
  const rootPkg = {
    name: "@ayulab/oh-my-pi",
    version: "0.4.1",
    path: fixtureRoot,
    pkg: { name: "@ayulab/oh-my-pi", version: "0.4.1" },
    isRoot: true,
  };

  mockParseCLI.mockReturnValue({ flags, positionals: [] } as never);
  mockGetPackages.mockReturnValue([rootPkg] as never);
  mockGetReleaseInputWorkspacePackages.mockReturnValue([] as never);
  mockBuildDepGraph.mockReturnValue({ nameMap: new Map([[rootPkg.name, rootPkg]]) } as never);
  mockHasPathChangesSinceRef.mockReturnValue(false);
  mockValidatePackage.mockReturnValue([] as never);
  mockValidateRootConsistency.mockReturnValue([] as never);
}

async function runEntrypoint(): Promise<void> {
  const previousArgv1 = process.argv[1] ?? publishEntrypoint;
  process.argv[1] = publishEntrypoint;
  try {
    vi.resetModules();
    await import("./publish-packages");
  } finally {
    process.argv[1] = previousArgv1;
  }
}

describe("publish entrypoint", () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "publish-entrypoint-test-"));
    fixtureScriptsDir = `${join(fixtureRoot, "scripts")}${sep}`;
    publishEntrypoint = join(fixtureRoot, "scripts", "publish-packages.ts");
    rootPackagePath = join(fixtureRoot, "package.json");
    workspaceManifest = readFileSync(join(workspaceRoot, "package.json"), "utf8");
    mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
    writeFileSync(rootPackagePath, workspaceManifest, "utf8");
  });

  beforeEach(() => {
    writeFileSync(rootPackagePath, workspaceManifest, "utf8");
    mockExecSync.mockReset();
    mockBuildDepGraph.mockReset();
    mockHasPathChangesSinceRef.mockReset();
    mockGetPackages.mockReset();
    mockGetReleaseInputWorkspacePackages.mockReset();
    mockParseCLI.mockReset();
    mockValidatePackage.mockReset();
    mockValidateRootConsistency.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockParseCLI.mockReturnValue({ flags: new Map(), positionals: [] } as never);
    mockHasPathChangesSinceRef.mockReturnValue(false);
    mockValidatePackage.mockReturnValue([] as never);
    mockValidateRootConsistency.mockReturnValue([] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test("aborts on unsupported flags", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    mockParseCLI.mockReturnValue({ flags: new Map([["package", true]]), positionals: [] } as never);

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGetPackages).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  test("aborts on unsupported positionals", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    mockParseCLI.mockReturnValue({ flags: new Map(), positionals: ["release-target"] } as never);

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGetPackages).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  test("aborts on validation failures", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    prepareRelease();
    mockValidatePackage.mockReturnValueOnce([
      { pkg: "@ayulab/oh-my-pi", field: "README.md", message: "missing" },
    ] as never);

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  test("skips root consistency checks when no root package is present", async () => {
    mockGetPackages.mockReturnValueOnce([
      {
        name: "@ayulab/pi-clarify",
        version: "0.4.1",
        path: `${fixtureRoot}/extensions/pi-clarify`,
        pkg: { name: "@ayulab/pi-clarify", version: "0.4.1" },
        isRoot: false,
      },
    ] as never);
    mockGetReleaseInputWorkspacePackages.mockReturnValueOnce([] as never);
    mockBuildDepGraph.mockReturnValueOnce({ nameMap: new Map() } as never);
    mockHasPathChangesSinceRef.mockReturnValue(false);
    mockValidatePackage.mockReturnValue([] as never);
    mockValidateRootConsistency.mockReturnValue([] as never);

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(mockValidateRootConsistency).not.toHaveBeenCalled();
  });

  test("aborts on dirty release scope before validation", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    prepareRelease();
    mockHasPathChangesSinceRef.mockReturnValueOnce(true);

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockValidatePackage).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  test("runs the dry-run flow", async () => {
    prepareRelease(new Map([["dry-run", true]]));

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(mockExecSync).toHaveBeenCalledWith("pnpm run build", {
      cwd: fixtureRoot,
      stdio: "inherit",
    });
    expect(mockExecSync).toHaveBeenCalledWith("pnpm run changeset status --verbose", {
      cwd: fixtureRoot,
      stdio: "inherit",
    });
    expect(mockExecSync).not.toHaveBeenCalledWith(
      expect.stringContaining("pnpm run changeset publish"),
      expect.anything(),
    );
  });

  test("runs the publish flow without otp", async () => {
    prepareRelease();

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(mockExecSync).toHaveBeenCalledWith("pnpm run changeset publish", {
      cwd: fixtureRoot,
      stdio: "inherit",
    });
  });

  test("runs the publish flow and restores the manifest", async () => {
    const originalManifest = readFileSync(rootPackagePath, "utf8");
    prepareRelease(new Map([["otp", "123456"]]));

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(mockExecSync).toHaveBeenCalledWith("pnpm run build", {
      cwd: fixtureRoot,
      stdio: "inherit",
    });
    expect(mockExecSync).toHaveBeenCalledWith("pnpm run changeset publish --otp 123456", {
      cwd: fixtureRoot,
      stdio: "inherit",
    });
    expect(readFileSync(rootPackagePath, "utf8")).toBe(originalManifest);
  });

  test("does not execute the entrypoint when argv[1] is missing", async () => {
    const previousArgv1 = process.argv[1] ?? publishEntrypoint;
    process.argv[1] = undefined as never;
    try {
      vi.resetModules();
      await import("./publish-packages");
    } finally {
      process.argv[1] = previousArgv1;
    }

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  test("reports uncaught entrypoint errors through the catch handler", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    mockGetPackages.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(runEntrypoint()).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(new Error("boom"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
