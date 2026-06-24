import { describe, test, expect } from "vitest";
import { loadConfig, defaultConfig } from "./config";

describe("loadConfig", () => {
  test("user gets defaults when no config provided", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.restoreOnFork).toBe(false);
    expect(config.restoreOnClone).toBe(false);
    expect(config.restoreOnResume).toBe(false);
    expect(config.restoreOnTree).toBe(false);
    expect(config.exclude).toContain("node_modules/");
    expect(config.exclude).toContain("**/.idea/workspace.xml");
    expect(config.exclude).not.toContain(".idea/workspace.xml");
    expect(config.exclude).toContain("**/.DS_Store");
    expect(config.exclude).toContain("**/Thumbs.db");
    expect(config.exclude).toContain("**/Desktop.ini");
    expect(config.exclude).not.toContain("*.iml");
  });

  test("boolean checkpoint restore flags override defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          enabled: false,
          autoCheckpoint: false,
          restoreOnClone: true,
          restoreOnResume: false,
          restoreOnTree: true,
          defaultSummaryInstructions: "focus on API",
          exclude: ["custom/**"],
          include: ["custom/keep.txt"],
          maxFileMB: 25,
        },
      },
    });
    expect(config.enabled).toBe(false);
    expect(config.autoCheckpoint).toBe(false);
    expect(config.restoreOnClone).toBe(true);
    expect(config.restoreOnResume).toBe(false);
    expect(config.restoreOnTree).toBe(true);
    expect(config.defaultSummaryInstructions).toBe("focus on API");
    expect(config.exclude).toContain("custom/**");
    expect(config.exclude).toContain("!custom/keep.txt");
    expect(config.exclude).toContain("node_modules/");
    expect(config.maxFileMB).toBe(25);
  });

  test("string restore flags fall back to defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          restoreOnFork: "always",
          restoreOnClone: "never",
          restoreOnResume: "always",
          restoreOnTree: "never",
        },
      },
    });
    expect(config.restoreOnFork).toBe(false);
    expect(config.restoreOnClone).toBe(false);
    expect(config.restoreOnResume).toBe(false);
    expect(config.restoreOnTree).toBe(false);
  });

  test("invalid restore options and missing fields fall back to defaults", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          restoreOnFork: null,
          restoreOnClone: 123,
          restoreOnResume: undefined,
          restoreOnTree: "ask",
          defaultSummaryInstructions: null,
        },
      },
    });
    expect(config.restoreOnFork).toBe(false);
    expect(config.restoreOnClone).toBe(false);
    expect(config.restoreOnResume).toBe(false);
    expect(config.restoreOnTree).toBe(false);
    expect(config.defaultSummaryInstructions).toBe("");
  });

  test("preserves negated include patterns", () => {
    const config = loadConfig({
      ayu: {
        checkpoint: {
          include: ["!already-negated"],
        },
      },
    });
    expect(config.exclude).toContain("!already-negated");
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
    expect(config.restoreOnTree).toBe(false);
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
