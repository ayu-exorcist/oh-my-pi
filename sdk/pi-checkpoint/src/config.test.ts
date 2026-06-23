import { describe, test, expect } from "vitest";
import { loadConfig, defaultConfig } from "./config";

describe("loadConfig", () => {
  test("user gets defaults when no config provided", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.restoreOnTree).toBe("never");
    expect(config.exclude).toContain("node_modules/");
    expect(config.exclude).toContain("**/.idea/workspace.xml");
    expect(config.exclude).not.toContain(".idea/workspace.xml");
    expect(config.exclude).toContain("**/.DS_Store");
    expect(config.exclude).toContain("**/Thumbs.db");
    expect(config.exclude).toContain("**/Desktop.ini");
    expect(config.exclude).not.toContain("*.iml");
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
          include: ["custom/keep.txt"],
          maxFileMB: 25,
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
    expect(config.exclude).toContain("custom/**");
    expect(config.exclude).toContain("!custom/keep.txt");
    expect(config.exclude).toContain("node_modules/");
    expect(config.maxFileMB).toBe(25);
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
