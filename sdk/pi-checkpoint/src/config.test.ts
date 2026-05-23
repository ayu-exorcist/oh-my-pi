import { describe, test, expect } from "vitest";
import { loadConfig, defaultConfig } from "./config";

describe("loadConfig", () => {
  test("user gets defaults when no config provided", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.restoreOnTree).toBe("never");
    expect(config.exclude).toContain("node_modules/**");
  });

  test("user overrides merge with defaults", () => {
    const config = loadConfig({
      checkpoint: {
        enabled: false,
        autoCheckpoint: false,
        restoreOnTree: "always",
        restoreOnClone: "always",
        defaultSummaryInstructions: "focus on API",
        exclude: ["custom/**"],
      },
    });
    expect(config.enabled).toBe(false);
    expect(config.autoCheckpoint).toBe(false);
    expect(config.restoreOnTree).toBe("always");
    expect(config.restoreOnClone).toBe("always");
    expect(config.defaultSummaryInstructions).toBe("focus on API");
    expect(config.exclude).toEqual(["custom/**"]);
  });

  test("invalid restore options and missing fields fall back to defaults", () => {
    const config = loadConfig({
      checkpoint: {
        restoreOnTree: "invalid",
        restoreOnFork: null,
        restoreOnClone: 123,
        restoreOnResume: undefined,
        defaultSummaryInstructions: null,
      },
    });
    expect(config.restoreOnTree).toBe("never");
    expect(config.restoreOnFork).toBe("always");
    expect(config.restoreOnClone).toBe("never");
    expect(config.restoreOnResume).toBe("never");
    expect(config.defaultSummaryInstructions).toBe("");
  });

  test("invalid primitive types fall back to defaults", () => {
    const config = loadConfig({
      checkpoint: {
        enabled: "yes",
        autoCheckpoint: "no",
        exclude: "not-an-array",
      },
    });
    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.exclude).toEqual(defaultConfig.exclude);
  });
});
