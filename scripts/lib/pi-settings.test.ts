import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

const { mockClose, mockQuestion } = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockQuestion: vi.fn(),
}));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}));

import { confirm, isStringArray, readSettings, writeSettings } from "./pi-settings";

describe("Pi settings helpers", () => {
  test("reads object settings and falls back to empty objects for invalid input", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-settings-test-"));
    try {
      const filePath = join(root, "settings.json");
      writeFileSync(filePath, JSON.stringify({ packages: [root] }), "utf8");
      await expect(readSettings(filePath)).resolves.toEqual({ packages: [root] });

      writeFileSync(filePath, JSON.stringify(["not", "record"]), "utf8");
      await expect(readSettings(filePath)).resolves.toEqual({});

      writeFileSync(filePath, "not json", "utf8");
      await expect(readSettings(filePath)).resolves.toEqual({});

      await expect(readSettings(join(root, "missing.json"))).resolves.toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes formatted settings and creates parent directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-settings-test-"));
    try {
      const filePath = join(root, "nested", "settings.json");
      await writeSettings(filePath, { packages: [root] });

      expect(await readFile(filePath, "utf8")).toBe(
        `${JSON.stringify({ packages: [root] }, null, 2)}\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("confirms only lowercase y and always closes readline", async () => {
    mockQuestion.mockImplementationOnce((_: string, resolve: (answer: string) => void) =>
      resolve(" y "),
    );
    await expect(confirm("Proceed? ")).resolves.toBe(true);

    mockQuestion.mockImplementationOnce((_: string, resolve: (answer: string) => void) =>
      resolve("yes"),
    );
    await expect(confirm("Proceed? ")).resolves.toBe(false);

    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  test("re-exports string array guard", () => {
    expect(isStringArray(["a"])).toBe(true);
    expect(isStringArray([1])).toBe(false);
  });
});
