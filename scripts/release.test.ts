import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./lib/cli", () => ({
  parseCLI: vi.fn(() => ({ flags: new Map(), positionals: [] })),
}));

vi.mock("./lib/release-args", () => ({
  parseReleaseRunOptions: vi.fn(() => ({ dryRun: false, otp: undefined })),
  rejectUnsupportedReleaseArgs: vi.fn(() => true),
}));

vi.mock("./publish-packages", () => ({
  publishPackages: vi.fn(async () => undefined),
}));

vi.mock("./sync-release-tags", () => ({
  syncReleaseTags: vi.fn(),
}));

import { fileURLToPath } from "node:url";
import { parseCLI as mockedParseCLI } from "./lib/cli";
import { parseReleaseRunOptions as mockedParseReleaseRunOptions } from "./lib/release-args";
import { publishPackages as mockedPublishPackages } from "./publish-packages";
import { syncReleaseTags as mockedSyncReleaseTags } from "./sync-release-tags";
import { runRelease } from "./release";

const mockParseCLI = vi.mocked(mockedParseCLI);
const mockParseReleaseRunOptions = vi.mocked(mockedParseReleaseRunOptions);
const mockPublishPackages = vi.mocked(mockedPublishPackages);
const mockSyncReleaseTags = vi.mocked(mockedSyncReleaseTags);

describe("release entrypoint", () => {
  beforeEach(() => {
    mockPublishPackages.mockReset();
    mockSyncReleaseTags.mockReset();
    mockParseCLI.mockReset();
    mockParseReleaseRunOptions.mockReset();
    mockPublishPackages.mockResolvedValue(undefined);
    mockParseCLI.mockReturnValue({ flags: new Map(), positionals: [] } as never);
    mockParseReleaseRunOptions.mockReturnValue({ dryRun: false, otp: undefined } as never);
  });

  test("returns early when unsupported args are detected", async () => {
    mockParseCLI.mockReturnValueOnce({ flags: new Map(), positionals: ["--bad"] } as never);
    const { rejectUnsupportedReleaseArgs: mockReject } = await import("./lib/release-args");
    vi.mocked(mockReject).mockReturnValueOnce(false);

    await expect(runRelease()).resolves.toBeUndefined();
    expect(mockedPublishPackages).not.toHaveBeenCalled();
    expect(mockedSyncReleaseTags).not.toHaveBeenCalled();
  });

  test("runs publish and sync flow", async () => {
    await expect(runRelease()).resolves.toBeUndefined();
    expect(mockPublishPackages).toHaveBeenCalledWith({ dryRun: false, otp: undefined });
    expect(mockSyncReleaseTags).toHaveBeenCalled();
  });

  test("skips sync in dry run", async () => {
    mockParseReleaseRunOptions.mockReturnValueOnce({ dryRun: true, otp: undefined } as never);

    await expect(runRelease()).resolves.toBeUndefined();
    expect(mockSyncReleaseTags).not.toHaveBeenCalled();
  });

  test("runs the entrypoint when imported as a script", async () => {
    const releaseEntry = fileURLToPath(new URL("./release.ts", import.meta.url));
    const previousArgv1 = process.argv[1] ?? "";
    process.argv[1] = releaseEntry;

    try {
      vi.resetModules();
      await import("./release");
      await Promise.resolve();
    } finally {
      process.argv[1] = previousArgv1;
    }

    expect(mockPublishPackages).toHaveBeenCalled();
  });

  test("catches errors from runRelease in the entrypoint script path", async () => {
    mockParseReleaseRunOptions.mockReturnValueOnce({ dryRun: false, otp: undefined } as never);
    mockPublishPackages.mockRejectedValueOnce(new Error("publish failed"));

    const releaseEntry = fileURLToPath(new URL("./release.ts", import.meta.url));
    const previousArgv1 = process.argv[1] ?? "";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    process.argv[1] = releaseEntry;

    try {
      vi.resetModules();
      await import("./release");
      // Give the async catch a tick to execute
      await Promise.resolve();
      await Promise.resolve();
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      process.argv[1] = previousArgv1;
      exitSpy.mockRestore();
    }
  });
});
