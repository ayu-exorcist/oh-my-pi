import { describe, test, expect, vi } from "vitest";
import { createMockRepo } from "./index";

describe("createMockRepo", () => {
  test("uses provided safeCheckout when given", async () => {
    const customSafeCheckout = vi.fn().mockResolvedValue({ ok: true as const, safetyHash: "abc" });
    const repo = createMockRepo({ safeCheckout: customSafeCheckout });

    const result = await repo.safeCheckout("target", "base");
    expect(customSafeCheckout).toHaveBeenCalledWith("target", "base");
    expect(result).toEqual({ ok: true, safetyHash: "abc" });
  });

  test("defaults safeCheckout when partial is empty object", async () => {
    const repo = createMockRepo({});
    const result = await repo.safeCheckout("target");
    expect(result).toEqual({
      ok: false,
      reason: "checkout-failed",
      error: "checkoutCommit not mocked",
    });
  });

  test("default safeCheckout skips dirty check when diffAgainst not provided", async () => {
    const repo = createMockRepo({
      checkoutCommit: vi.fn().mockResolvedValue(undefined),
    });
    const result = await repo.safeCheckout("target", "base");
    expect(result).toEqual({ ok: true, safetyHash: undefined });
  });

  test("default withLock passes function through", async () => {
    const repo = createMockRepo();
    const fn = vi.fn().mockResolvedValue("result");
    const result = await repo.withLock(fn);
    expect(fn).toHaveBeenCalled();
    expect(result).toBe("result");
  });

  test("default safeCheckout reports non-Error checkout failure without safety commit", async () => {
    const repo = createMockRepo({
      checkoutCommit: vi.fn().mockRejectedValue("string error"),
    });

    const result = await repo.safeCheckout("target");
    expect(result).toEqual({
      ok: false,
      reason: "checkout-failed",
      error: "string error",
    });
  });

  test("default safeCheckout reports non-Error checkout and rollback failure", async () => {
    const repo = createMockRepo({
      stageAll: vi.fn().mockResolvedValue(undefined),
      diffAgainst: vi.fn().mockResolvedValue(""),
      createSafetyCommit: vi.fn().mockResolvedValue("safety"),
      checkoutCommit: vi
        .fn()
        .mockRejectedValueOnce("string error")
        .mockRejectedValueOnce("string rollback"),
    });

    const result = await repo.safeCheckout("target", "base");
    expect(result).toEqual({
      ok: false,
      reason: "checkout-failed",
      error: "string error",
      rollbackError: "string rollback",
    });
  });
});
