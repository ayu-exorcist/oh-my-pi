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

describe("setup script", () => {
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

  test("does nothing when already registered", async () => {
    mockReadSettings.mockResolvedValue({ packages: [process.cwd()] });

    await import("./setup");
    await Promise.resolve();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  test("falls back to an empty package list when packages is invalid", async () => {
    mockIsStringArray.mockReturnValue(false);
    mockReadSettings.mockResolvedValue({ packages: 123 });
    mockConfirm.mockResolvedValue(true);

    await import("./setup");
    await Promise.resolve();

    expect(mockWriteSettings).toHaveBeenCalled();
  });

  test("aborts when not confirmed", async () => {
    mockReadSettings.mockResolvedValue({ packages: ["existing"] });
    mockConfirm.mockResolvedValue(false);

    await import("./setup").catch(() => {});
    await Promise.resolve();

    expect(exitMock).toHaveBeenCalledWith(0);
    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  test("writes updated settings when confirmed", async () => {
    mockReadSettings.mockResolvedValue({ packages: ["existing"] });
    mockConfirm.mockResolvedValue(true);

    await import("./setup");
    await Promise.resolve();

    expect(mockWriteSettings).toHaveBeenCalled();
  });

  test("reports read errors through the catch handler", async () => {
    mockReadSettings.mockRejectedValueOnce(new Error("boom"));

    await import("./setup").catch(() => {});
    await Promise.resolve();

    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
