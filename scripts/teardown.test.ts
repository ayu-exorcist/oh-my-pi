import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockReadSettings = vi.fn();
const mockWriteSettings = vi.fn();
const mockConfirm = vi.fn();
const mockIsStringArray = vi.fn();

vi.mock("./lib/pi-settings", () => ({
  readSettings: mockReadSettings,
  writeSettings: mockWriteSettings,
  confirm: mockConfirm,
  isStringArray: mockIsStringArray,
}));

// Capture cwd before process is stubbed
const repoRoot = process.cwd();

describe("teardown script", () => {
  let exitMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exitMock = vi.fn().mockImplementation(((code?: number) => {
      if (code === 0) {
        // Simulate process termination on abort: throw to prevent further execution
        throw Object.assign(new Error(`process.exit(${code})`), { code });
      }
      // For code !== 0 (e.g., error handler), just return to avoid unhandled rejection
      return undefined;
    }) as never);
    vi.stubGlobal("process", { ...process, exit: exitMock });
    vi.resetModules();
    mockReadSettings.mockReset();
    mockWriteSettings.mockReset();
    mockConfirm.mockReset();
    mockIsStringArray.mockReset();
    mockIsStringArray.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("does nothing when not registered", async () => {
    mockReadSettings.mockResolvedValue({ packages: ["repo"] });

    await import("./teardown");
    await Promise.resolve();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  test("falls back to an empty package list when packages is invalid", async () => {
    mockIsStringArray.mockReturnValueOnce(false);
    mockReadSettings.mockResolvedValue({ packages: 123 });

    await import("./teardown");
    await Promise.resolve();

    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  test("aborts when not confirmed", async () => {
    mockReadSettings.mockResolvedValue({ packages: [repoRoot, "repo"] });
    mockConfirm.mockResolvedValue(false);

    await import("./teardown").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exitMock).toHaveBeenCalledWith(0);
    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  test("writes updated settings when confirmed", async () => {
    mockReadSettings.mockResolvedValue({ packages: [repoRoot, "repo"] });
    mockConfirm.mockResolvedValue(true);

    await import("./teardown");
    await Promise.resolve();

    expect(mockWriteSettings).toHaveBeenCalled();
  });

  test("reports read errors through the catch handler", async () => {
    mockReadSettings.mockRejectedValueOnce(new Error("boom"));

    await import("./teardown").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
