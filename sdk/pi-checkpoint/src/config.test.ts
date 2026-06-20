import { describe, test, expect } from "vitest";
import { loadConfig, defaultConfig } from "./config";

describe("loadConfig", () => {
  test("user gets defaults when no config provided", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.restoreOnResume).toBe("never");
    expect(config.restoreOnTree).toBe("never");
    expect(config.exclude).toContain("node_modules/");
    expect(config.exclude).toContain("**/node_modules/");
    expect(config.exclude).toContain(".gradle/");
    expect(config.exclude).toContain("**/.next/");
    expect(config.exclude).not.toContain("vendor/");
    expect(config.exclude).not.toContain("*.d.ts");
    expect(config.retention).toEqual({ enabled: true, maxAge: "30d", minRetention: "1d" });
    expect(config.maxFileBytes).toBeUndefined();
  });

  test("user overrides merge with defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          enabled: false,
          autoCheckpoint: false,
          restoreOnClone: "always",
          restoreOnResume: "never",
          defaultSummaryInstructions: "focus on API",
          exclude: ["custom/**"],
          retention: { enabled: false, maxAge: "7d", minRetention: "2d", maxCount: 100 },
          maxFileBytes: 1024,
        },
        rewind: {
          restoreOnTree: "ask",
        },
      },
    });
    expect(config.enabled).toBe(false);
    expect(config.autoCheckpoint).toBe(false);
    expect(config.restoreOnClone).toBe("always");
    expect(config.restoreOnResume).toBe("never");
    expect(config.restoreOnTree).toBe("ask");
    expect(config.defaultSummaryInstructions).toBe("focus on API");
    expect(config.exclude).toContain("node_modules/");
    expect(config.exclude).toContain("custom/**");
    expect(config.retention).toEqual({
      enabled: false,
      maxAge: "7d",
      minRetention: "2d",
      maxCount: 100,
    });
    expect(config.maxFileBytes).toBe(1024);
  });

  test("invalid restore options and missing fields fall back to defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          restoreOnFork: null,
          restoreOnClone: 123,
          restoreOnResume: undefined,
          defaultSummaryInstructions: null,
        },
        rewind: {
          restoreOnTree: "invalid",
        },
      },
    });
    expect(config.restoreOnFork).toBe("always");
    expect(config.restoreOnClone).toBe("always");
    expect(config.restoreOnResume).toBe("never");
    expect(config.restoreOnTree).toBe("never");
    expect(config.defaultSummaryInstructions).toBe("");
  });

  test("invalid retention field types fall back to defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          retention: {
            enabled: "false",
            maxAge: 7,
            minRetention: false,
            maxCount: "3",
          },
        },
      },
    });

    expect(config.retention).toEqual({ enabled: true, maxAge: "30d", minRetention: "1d" });
  });

  test("invalid primitive types fall back to defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          enabled: "yes",
          autoCheckpoint: "no",
          exclude: "not-an-array",
        },
      },
    });
    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.restoreOnTree).toBe("never");
    expect(config.exclude).toEqual(defaultConfig.exclude);
  });

  test("top-level checkpoint config is ignored", () => {
    const config = loadConfig({
      checkpoint: {
        enabled: false,
      },
    });
    expect(config.enabled).toBe(defaultConfig.enabled);
  });
});
