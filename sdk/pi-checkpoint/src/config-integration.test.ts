import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("loadConfig integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-config-test-"));
    vi.stubEnv("HOME", tmpDir);
    vi.stubEnv("USERPROFILE", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("user can read global settings from ~/.pi/agent/settings.json", async () => {
    const globalDir = path.join(tmpDir, ".pi", "agent");
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({
        ayu: {
          checkpoint: {
            enabled: false,
            restoreOnFork: "never",
          },
          rewind: {
            restoreOnTree: "always",
          },
        },
      }),
      "utf8",
    );

    const { loadConfigFromFile } = await import("./config");
    const config = loadConfigFromFile(globalDir);

    expect(config.enabled).toBe(false);
    expect(config.restoreOnFork).toBe("never");
    expect(config.restoreOnTree).toBe("always");
    expect(config.autoCheckpoint).toBe(true); // default kept
  });

  test("user can read project settings from .pi/settings.json", async () => {
    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".pi", "settings.json"),
      JSON.stringify({
        ayu: {
          checkpoint: {
            exclude: ["custom/**"],
          },
        },
      }),
      "utf8",
    );

    const { loadConfigFromFile } = await import("./config");
    const config = loadConfigFromFile(path.join(projectDir, ".pi"));

    expect(config.exclude).toEqual(["custom/**"]);
    expect(config.enabled).toBe(true); // default
  });

  test("loadConfigFromFile returns defaults when file does not exist", async () => {
    const { loadConfigFromFile } = await import("./config");
    const config = loadConfigFromFile(path.join(tmpDir, "nonexistent"));

    expect(config.enabled).toBe(true);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.exclude).toContain("node_modules/**");
    expect(config.exclude).toContain("**/node_modules/**");
  });

  test("loadConfigFromFile returns defaults when JSON is invalid", async () => {
    const badDir = path.join(tmpDir, "bad");
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, "settings.json"), "not json", "utf8");

    const { loadConfigFromFile } = await import("./config");
    const config = loadConfigFromFile(badDir);

    expect(config.enabled).toBe(true);
  });

  test("loadConfigFromFile re-throws unexpected errors", async () => {
    const badDir = path.join(tmpDir, "unreadable");
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, "settings.json"), "{}", "utf8");
    // Replace file with a directory so readFileSync throws EISDIR
    await fs.rm(path.join(badDir, "settings.json"));
    await fs.mkdir(path.join(badDir, "settings.json"), { recursive: true });

    const { loadConfigFromFile } = await import("./config");
    expect(() => loadConfigFromFile(badDir)).toThrow();
  });

  test("loadConfigFromFile returns defaults when JSON is an array", async () => {
    const arrDir = path.join(tmpDir, "array");
    await fs.mkdir(arrDir, { recursive: true });
    await fs.writeFile(path.join(arrDir, "settings.json"), "[]", "utf8");

    const { loadConfigFromFile } = await import("./config");
    const config = loadConfigFromFile(arrDir);

    expect(config.enabled).toBe(true);
  });
});
